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

const profileLookup = vi.hoisted(() => {
  const where = vi.fn();
  const leftJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ leftJoin }));
  return { where, leftJoin, from, select: vi.fn(() => ({ from })) };
});

const sessionRecord = {
  userId: 'user-1',
  role: 'employee',
  ipHash: 'ip-hash',
  userAgent: 'test-agent',
  refreshHash: 'refresh-hash',
};

vi.mock('redis', () => ({
  createClient: redis.createClient,
}));

vi.mock('@/backend/auth/tokens', () => tokens);
vi.mock('@/backend/db', () => ({ db: { select: profileLookup.select } }));
vi.mock('@/backend/db/schema', () => ({
  profiles: { id: 'id', accountStatus: 'accountStatus' },
  userRoles: { userId: 'userId', role: 'role' },
}));
vi.mock('drizzle-orm', () => ({ eq: vi.fn((column, value) => ({ column, value })) }));

describe('Redis-backed authentication security behavior', () => {
  beforeEach(() => {
    vi.resetModules();
    redis.client.isOpen = false;
    redis.client.on.mockReset();
    redis.client.connect.mockReset().mockRejectedValue(new Error('Redis unavailable'));
    redis.client.hGetAll.mockReset();
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'session:session-id') return sessionRecord;
      if (key === 'refresh:user-1:refresh-hash') return { sessionId: 'session-id' };
      return {};
    });
    redis.client.hSet.mockReset().mockResolvedValue(undefined);
    redis.client.expire.mockReset().mockResolvedValue(true);
    redis.client.keys.mockReset();
    redis.client.eval.mockReset();
    redis.client.del.mockReset().mockResolvedValue(1);
    profileLookup.where.mockReset().mockResolvedValue([
      { accountStatus: 'active', role: 'employee' },
    ]);
    profileLookup.where.mockClear();
    profileLookup.leftJoin.mockClear();
    profileLookup.from.mockClear();
    profileLookup.select.mockClear();
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
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
    expect(redis.client.connect).toHaveBeenCalledOnce();
    expect(redis.client.hGetAll).not.toHaveBeenCalled();
  });

  it.each(['inactive', 'suspended'] as const)('rejects Redis sessions whose profile is %s', async accountStatus => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'session:session-id') return sessionRecord;
      if (key === 'refresh:user-1:refresh-hash') return { sessionId: 'session-id' };
      return {};
    });
    profileLookup.where.mockResolvedValue([{ accountStatus, role: 'employee' }]);
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
    expect(profileLookup.select).toHaveBeenCalledOnce();
  });

  it('rejects Redis sessions whose profile no longer exists', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    profileLookup.where.mockResolvedValue([]);
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
  });

  it('accepts a session with a matching refresh-token index and active profile', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toMatchObject({
      userId: 'user-1',
      role: 'employee',
      refreshHash: 'refresh-hash',
    });
  });

  it('rejects a session after its role is no longer assigned', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'session:session-id') return { ...sessionRecord, role: 'administrator' };
      if (key === 'refresh:user-1:refresh-hash') return { sessionId: 'session-id' };
      return {};
    });
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
  });

  it('continues to accept sessions for any role still assigned to a multi-role account', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'session:session-id') return { ...sessionRecord, role: 'administrator' };
      if (key === 'refresh:user-1:refresh-hash') return { sessionId: 'session-id' };
      return {};
    });
    profileLookup.where.mockResolvedValue([
      { accountStatus: 'active', role: 'employee' },
      { accountStatus: 'active', role: 'administrator' },
    ]);
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toMatchObject({ role: 'administrator' });
  });

  it('preserves the employee fallback for profiles without explicit role rows', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    profileLookup.where.mockResolvedValue([{ accountStatus: 'active', role: null }]);
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toMatchObject({ role: 'employee' });
  });

  it('rejects sessions without a matching refresh-token index', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'session:session-id') return sessionRecord;
      return {};
    });
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
    expect(profileLookup.select).not.toHaveBeenCalled();
  });

  it('rejects a refresh-token index that points to another session', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.hGetAll.mockImplementation(async (key: string) => {
      if (key === 'session:session-id') return sessionRecord;
      if (key === 'refresh:user-1:refresh-hash') return { sessionId: 'different-session' };
      return {};
    });
    const { getSession } = await import('@/backend/auth/session');

    await expect(getSession('session-id')).resolves.toBeNull();
    expect(profileLookup.select).not.toHaveBeenCalled();
  });

  it('reports incomplete session revocation when Redis is unavailable', async () => {
    const { revokeAllUserSessions } = await import('@/backend/auth/session');

    await expect(revokeAllUserSessions('user-1')).resolves.toBe(false);
  });

  it('confirms session revocation only after deleting the session and refresh token', async () => {
    redis.client.connect.mockImplementation(async () => {
      redis.client.isOpen = true;
    });
    redis.client.keys.mockResolvedValue(['refresh:user-1:refresh-hash']);
    redis.client.hGetAll.mockResolvedValue({ sessionId: 'session-id' });
    const { revokeAllUserSessions } = await import('@/backend/auth/session');

    await expect(revokeAllUserSessions('user-1')).resolves.toBe(true);
    expect(redis.client.del).toHaveBeenNthCalledWith(1, 'session:session-id');
    expect(redis.client.del).toHaveBeenNthCalledWith(2, 'refresh:user-1:refresh-hash');
  });

  it('preserves the documented fail-open rate-limit behavior when Redis is unavailable', async () => {
    const { checkRateLimit } = await import('@/backend/auth/session');

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
    const { rotateRefreshToken } = await import('@/backend/auth/session');

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
