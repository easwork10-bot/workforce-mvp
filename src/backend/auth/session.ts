import 'server-only';
import { createClient } from 'redis';
import { hashToken, hashIp, decodeJwt } from './tokens';
import { requireRedisUrl } from '../redisUrl';

type RedisClient = ReturnType<typeof createClient>;
let redisClient: RedisClient | null = null;
let redisConnecting: Promise<RedisClient> | null = null;

/**
 * Custom error for Redis unavailability - allows callers to fail safely
 */
export class RedisUnavailableError extends Error {
  constructor(message = 'Redis unavailable') {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}

export async function getRedis(): Promise<RedisClient> {
  if (redisClient?.isOpen) return redisClient;

  // Prevent multiple simultaneous connection attempts
  if (redisConnecting) {
    try {
      return await redisConnecting;
    } catch {
      redisConnecting = null;
    }
  }

  redisConnecting = (async () => {
    const client = createClient({
      url: requireRedisUrl(process.env.REDIS_URL),
      // Fail fast on connection issues
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: false, // Disable auto-reconnect, fail fast
      },
    });

    client.on('error', () => {
      console.error('[Redis] Client error');
    });

    await client.connect();
    return client;
  })();

  try {
    redisClient = await redisConnecting;
    return redisClient;
  } catch {
    redisConnecting = null;
    console.error('[Redis] Connection failed');
    throw new RedisUnavailableError('Failed to connect to Redis');
  }
}

/**
 * Store session in Redis with TTL
 * Throws RedisUnavailableError if Redis is unreachable
 */
export async function createSession(
  jti: string,
  userId: string,
  role: 'administrator' | 'supervisor' | 'employee',
  ip: string,
  userAgent: string,
  refreshToken: string
): Promise<void> {
  const redis = await getRedis();
  const refreshHash = hashToken(refreshToken);
  const ipHash = hashIp(ip);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

  const sessionData = {
    userId,
    role,
    ipHash,
    userAgent,
    createdAt: Date.now().toString(),
    expiresAt: expiresAt.toString(),
    refreshHash,
  };

  await redis.hSet(`session:${jti}`, sessionData);
  await redis.expire(`session:${jti}`, 7 * 24 * 60 * 60); // 7 days TTL

  // Index refresh token by user for rotation/reuse detection
  await redis.hSet(`refresh:${userId}:${refreshHash}`, {
    sessionId: jti,
    createdAt: Date.now().toString(),
    expiresAt: (Date.now() + 30 * 24 * 60 * 60 * 1000).toString(),
    used: 'false',
  });
  await redis.expire(`refresh:${userId}:${refreshHash}`, 30 * 24 * 60 * 60);
}

/**
 * Lookup session by JTI. Missing or malformed session records are unauthenticated;
 * Redis failures remain distinguishable so callers can return service unavailable.
 */
export async function getSession(jti: string): Promise<{
  userId: string;
  role: 'administrator' | 'supervisor' | 'employee';
  ipHash: string;
  userAgent: string;
  refreshHash: string;
} | null> {
  let data: Record<string, string>;
  try {
    const redis = await getRedis();
    data = await redis.hGetAll(`session:${jti}`);
  } catch {
    console.error('[getSession] Redis error while looking up a session');
    throw new RedisUnavailableError('Authentication service is unavailable');
  }

  const role = data?.role;
  if (
    !data ||
    !data.userId ||
    (role !== 'administrator' && role !== 'supervisor' && role !== 'employee') ||
    !data.ipHash ||
    !data.userAgent ||
    !data.refreshHash
  ) {
    return null;
  }

  return {
    userId: data.userId,
    role,
    ipHash: data.ipHash,
    userAgent: data.userAgent,
    refreshHash: data.refreshHash,
  };
}

/**
 * Delete session and associated refresh token
 * Silently handles Redis unavailability
 */
export async function deleteSession(jti: string, userId: string, refreshHash: string): Promise<void> {
  try {
    const redis = await getRedis();
    await redis.del(`session:${jti}`);
    await redis.del(`refresh:${userId}:${refreshHash}`);
  } catch {
    console.error('[deleteSession] Redis error');
    // Don't throw - best effort cleanup
  }
}

/**
 * Validate and rotate refresh token
 * Returns new token pair if valid, null if invalid/reused/unavailable
 */
export async function rotateRefreshToken(
  userId: string,
  presentedRefreshToken: string,
  ip: string,
  userAgent: string
): Promise<{
  accessToken: string;
  refreshToken: string;
  jti: string;
  role: 'administrator' | 'supervisor' | 'employee';
} | null> {
  const redis = await getRedis();
  const presentedHash = hashToken(presentedRefreshToken);
  const refreshKey = `refresh:${userId}:${presentedHash}`;
  let refreshData: Record<string, string>;
  try {
    refreshData = await redis.hGetAll(refreshKey);
  } catch {
    console.error('[rotateRefreshToken] Redis error reading refresh token');
    throw new RedisUnavailableError('Authentication service is unavailable');
  }

  if (
    !refreshData.sessionId ||
    (refreshData.used !== 'false' && refreshData.used !== 'true')
  ) {
    return null; // Invalid refresh token
  }

  // Atomically claim the single-use refresh token so concurrent rotations cannot both proceed.
  let claimed: number;
  try {
    claimed = Number(await redis.eval(
      `if redis.call('HGET', KEYS[1], 'used') ~= 'false' then
        return 0
      end
      redis.call('HSET', KEYS[1], 'used', 'true')
      return 1`,
      { keys: [refreshKey], arguments: [] }
    ));
  } catch {
    console.error('[rotateRefreshToken] Redis error claiming refresh token');
    throw new RedisUnavailableError('Authentication service is unavailable');
  }

  // REUSE DETECTION: If another request already claimed the token, revoke the session family.
  if (refreshData.used === 'true' || claimed !== 1) {
    console.warn(`[Security] Refresh token reuse detected for user ${userId}, revoking all sessions`);
    try {
      await revokeAllUserSessions(userId);
    } catch {
      // Best effort
    }
    return null;
  }

  // Get old session to retrieve role
  const oldSession = await getSession(refreshData.sessionId);
  if (!oldSession) return null;

  // Delete old session
  try {
    await redis.del(`session:${refreshData.sessionId}`);
  } catch {
    console.error('[rotateRefreshToken] Redis error deleting the previous session');
    throw new RedisUnavailableError('Authentication service is unavailable');
  }

  // Create new session with rotated tokens
  const { createTokenPair } = await import('./tokens');
  const { accessToken, refreshToken } = await createTokenPair(
    userId,
    oldSession.role,
    ip
  );

  // Extract JTI from new access token (decode without verification since we just created it)
  const newJti = decodeJwt(accessToken).jti as string;

  try {
    await createSession(newJti, userId, oldSession.role, ip, userAgent, refreshToken);
  } catch {
    console.error('[rotateRefreshToken] Failed to create new session');
    throw new RedisUnavailableError('Authentication service is unavailable');
  }

  return {
    accessToken,
    refreshToken,
    jti: newJti,
    role: oldSession.role,
  };
}

/**
 * Revoke all sessions for a user (used on logout, password change, token reuse)
 * Silently handles Redis unavailability
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  let redis;
  try {
    redis = await getRedis();
  } catch {
    console.error('[revokeAllUserSessions] Redis unavailable');
    return;
  }

  try {
    for await (const key of redis.scanIterator({
      MATCH: `refresh:${userId}:*`,
      COUNT: 100,
    })) {
      try {
        const data = await redis.hGetAll(key);
        if (data.sessionId) {
          await redis.del(`session:${data.sessionId}`);
        }
        await redis.del(key);
      } catch {
        console.error('[revokeAllUserSessions] Failed to revoke a session record');
      }
    }
  } catch {
    console.error('[revokeAllUserSessions] Redis error during key iteration');
  }
}

/**
 * Rate limiting - returns true if allowed, false if rate limited
 * Uses simple counter with TTL (fixed window) for simplicity
 * Fail-closed: callers must not bypass authentication abuse controls when Redis is unavailable.
 */
export async function checkRateLimit(
  ip: string,
  endpoint: string,
  maxRequests: number = 5,
  windowMs: number = 60 * 1000
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  let redis;
  try {
    redis = await getRedis();
  } catch {
    console.error('[checkRateLimit] Redis unavailable');
    throw new RedisUnavailableError('Rate limiting is unavailable');
  }

  const key = `ratelimit:${ip}:${endpoint}`;
  const now = Date.now();
  const windowSec = Math.ceil(windowMs / 1000);

  try {
    // Simple fixed-window counter
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSec);
    }

    if (count > maxRequests) {
      const ttl = await redis.ttl(key);
      return { allowed: false, remaining: 0, resetAt: now + ttl * 1000 };
    }

    return { allowed: true, remaining: maxRequests - count, resetAt: now + windowMs };
  } catch {
    console.error('[checkRateLimit] Redis error during operation');
    throw new RedisUnavailableError('Rate limiting is unavailable');
  }
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRedis(): Promise<void> {
  if (redisClient?.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}