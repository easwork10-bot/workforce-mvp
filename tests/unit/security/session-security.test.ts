import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const redis = vi.hoisted(() => {
  const client = {
    isOpen: false,
    on: vi.fn(),
    connect: vi.fn(),
    hGetAll: vi.fn(),
    hSet: vi.fn(),
    expire: vi.fn(),
    scanIterator: vi.fn(),
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
  verifyTokenFromCookie: vi.fn(async () => null as null | {
    sub: string;
    role: 'administrator' | 'supervisor' | 'employee';
    jti: string;
    ipHash: string;
  }),
  createTokenPair: vi.fn(async () => ({
    accessToken: 'new-access-token',
    refreshToken: 'new-refresh-token',
  })),
}));

vi.mock('redis', () => ({
  createClient: redis.createClient,
}));

vi.mock('@/backend/auth/tokens', () => tokens);

describe('Redis-backed authentication security behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.REDIS_URL = 'redis://127.0.0.1:6379';
    redis.client.isOpen = false;
    redis.client.on.mockReset();
    redis.client.connect.mockReset().mockRejectedValue(new Error('Redis unavailable'));
    redis.client.hGetAll.mockReset();
    redis.client.hSet.mockReset().mockResolvedValue(undefined);
    redis.client.expire.mockReset().mockResolvedValue(true);
    redis.client.scanIterator.mockReset();
    redis.client.eval.mockReset();
    redis.client.del.mockReset().mockResolvedValue(1);
    redis.createClient.mockClear();
    tokens.hashToken.mockReset().mockReturnValue('refresh-hash');
    tokens.hashIp.mockReset().mockReturnValue('ip-hash');
    tokens.decodeJwt.mockReset().mockReturnValue({ jti: 'new-session' });
    tokens.verifyTokenFromCookie.mockReset().mockResolvedValue(null);
    tokens.createTokenPair.mockReset().mockResolvedValue({
      accessToken: 'new-access-token',
      refreshToken: 'new-refresh-token',
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reports Redis unavailability distinctly when session lookup fails', async () => {
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id'))
      .rejects.toThrow('Authentication service is unavailable');
    expect(redis.client.connect).toHaveBeenCalledOnce();
    expect(redis.client.hGetAll).not.toHaveBeenCalled();
  });

  it('returns no session for a missing or malformed record', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockResolvedValue({
      userId: 'user-1',
      role: 'unsupported',
      ipHash: 'ip-hash',
      userAgent: 'test-agent',
      refreshHash: 'refresh-hash',
    });
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
  });

  it('does not expose Redis operation errors when session lookup is unavailable', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockRejectedValue(new Error('redis://user:secret@host'));
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id'))
      .rejects.toThrow('Authentication service is unavailable');
    expect(console.error).toHaveBeenCalledWith(
      '[getSession] Redis error while looking up a session',
    );
    expect(console.error).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringContaining('secret'),
    );
  });

  it('does not log Redis connection details during best-effort session cleanup', async () => {
    const connectionError = new Error('redis://user:password@database.example');
    redis.client.connect.mockRejectedValue(connectionError);
    const { deleteSession } = await import('@/backend/auth/session');

    await expect(deleteSession('session-id', 'user-1', 'refresh-hash')).resolves.toBeUndefined();
    expect(console.error).toHaveBeenCalledWith('[deleteSession] Redis error');
    expect(console.error).not.toHaveBeenCalledWith(
      '[deleteSession] Redis error:',
      connectionError,
    );
  });

  it('returns service unavailable rather than an unauthenticated response on Redis failure', async () => {
    tokens.verifyTokenFromCookie.mockResolvedValue({
      sub: 'user-1',
      role: 'employee',
      jti: 'session-id',
      ipHash: 'ip-hash',
    });
    const { requireAuth } = await import('@/backend/security/requireAuth');
    const result = await requireAuth(new NextRequest('https://workforce.example/api/protected'));

    expect(result).toBeInstanceOf(NextResponse);
    if (result instanceof NextResponse) {
      expect(result.status).toBe(503);
      expect(await result.json()).toEqual({
        error: 'Authentication service temporarily unavailable',
      });
    }
  });

  it('fails closed when Redis is unavailable for rate limiting', async () => {
    const { checkRateLimit } = await import('@/backend/auth/session');

    await expect(checkRateLimit('127.0.0.1', 'login', 5, 60_000))
      .rejects.toThrow('Rate limiting is unavailable');
  });

  it('does not create a Redis client when REDIS_URL is missing', async () => {
    delete process.env.REDIS_URL;
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id'))
      .rejects.toThrow('Authentication service is unavailable');
    expect(redis.createClient).not.toHaveBeenCalled();
  });

  it('allows only one of two concurrent requests to rotate the same refresh token', async () => {
    let claimed = false;
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.scanIterator.mockImplementation(() => (async function* () {
      yield 'refresh:user-1:refresh-hash';
    })());
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
    const { rotateRefreshToken } = await import('@/backend/auth/session');

    const results = await Promise.all([
      rotateRefreshToken('user-1', 'old-refresh-token', '127.0.0.1', 'test-agent'),
      rotateRefreshToken('user-1', 'old-refresh-token', '127.0.0.1', 'test-agent'),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((result) => result === null)).toHaveLength(1);
    expect(redis.client.eval).toHaveBeenCalledTimes(2);
    expect(redis.client.hGetAll).toHaveBeenCalledWith('refresh:user-1:refresh-hash');
    expect(redis.client.scanIterator).toHaveBeenCalledOnce();
    expect(tokens.createTokenPair).toHaveBeenCalledOnce();
  });

  it('distinguishes Redis failure from an invalid refresh token', async () => {
    const { rotateRefreshToken } = await import('@/backend/auth/session');

    await expect(rotateRefreshToken('user-1', 'old-refresh-token', '127.0.0.1', 'test-agent'))
      .rejects.toThrow('Failed to connect to Redis');
  });
});
