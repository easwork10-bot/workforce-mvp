import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const redis = vi.hoisted(() => {
  const client = {
    isOpen: false,
    on: vi.fn(),
    connect: vi.fn(),
    hGetAll: vi.fn(),
    hSet: vi.fn(),
    expire: vi.fn(),
    keys: vi.fn(),
    eval: vi.fn(),
    del: vi.fn(),
  };
  return {
    client,
    createClient: vi.fn(() => client),
  };
});

const tokens = vi.hoisted(() => ({
  hashToken: vi.fn(() => 'refresh-hash'),
  hashIp: vi.fn(() => 'ip-hash'),
  decodeJwt: vi.fn(() => ({ jti: 'new-session' })),
  createTokenPair: vi.fn(async () => ({
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
  })),
}));

vi.mock('redis', () => ({
  createClient: redis.createClient,
}));

vi.mock('@/lib/auth/tokens', () => tokens);

describe('Redis-backed authentication security behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    redis.client.isOpen = false;
    redis.client.on.mockReset();
    redis.client.connect.mockReset().mockRejectedValue(new Error('Redis unavailable'));
    redis.client.hGetAll.mockReset();
    redis.client.hSet.mockReset().mockResolvedValue(undefined);
    redis.client.expire.mockReset().mockResolvedValue(true);
    redis.client.keys.mockReset();
    redis.client.eval.mockReset();
    redis.client.del.mockReset().mockResolvedValue(1);
    redis.createClient.mockClear();
    tokens.hashToken.mockReset().mockReturnValue('refresh-hash');
    tokens.hashIp.mockReset().mockReturnValue('ip-hash');
    tokens.decodeJwt.mockReset().mockReturnValue({ jti: 'new-session' });
    tokens.createTokenPair.mockReset().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fails closed when Redis cannot validate a session', async () => {
    const { getSession } = await import('@/lib/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
    expect(redis.client.connect).toHaveBeenCalledOnce();
    expect(redis.client.hGetAll).not.toHaveBeenCalled();
  });

  it('preserves the documented fail-open rate-limit behavior when Redis is unavailable', async () => {
    const { checkRateLimit } = await import('@/lib/auth/session');

    const result = await checkRateLimit('127.0.0.1', 'login', 5, 60_000);

    expect(result).toMatchObject({ allowed: true, remaining: 5 });
    expect(result.resetAt).toBeGreaterThan(Date.now());
  });

  it('allows only one of two concurrent requests to rotate the same refresh token', async () => {
    let claimed = false;
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.keys.mockResolvedValue(['refresh:user-1:refresh-hash']);
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'refresh:user-1:refresh-hash') {
        return { sessionId: 'old-session', used: claimed ? 'true' : 'false' };
      }
      if (key === 'session:old-session') {
        return {
          userId: 'user-1',
          role: 'employee',
          ipHash: 'ip-hash',
          userAgent: 'test-agent',
          refreshHash: 'refresh-hash',
        };
      }
      return {};
    });
    redis.client.eval.mockImplementation(async () => {
      if (claimed) return 0;
      claimed = true;
      return 1;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { rotateRefreshToken } = await import('@/lib/auth/session');

    const results = await Promise.all([
      rotateRefreshToken('user-1', 'old-refresh-token', '127.0.0.1', 'test-agent'),
      rotateRefreshToken('user-1', 'old-refresh-token', '127.0.0.1', 'test-agent'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(redis.client.eval).toHaveBeenCalledTimes(2);
    expect(tokens.createTokenPair).toHaveBeenCalledOnce();
  });
});
