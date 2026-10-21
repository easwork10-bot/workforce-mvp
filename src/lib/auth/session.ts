import { createClient } from 'redis';
import { hashToken, hashIp } from './tokens';
import { decodeJwt } from './tokens';

// Redis client - lazy initialization
// Use `any` to avoid complex generic type issues with redis v4
let redisClient: any = null;
let redisConnecting: Promise<any> | null = null;

/**
 * Custom error for Redis unavailability - allows callers to fail safely
 */
export class RedisUnavailableError extends Error {
  constructor(message = 'Redis unavailable') {
    super(message);
    this.name = 'RedisUnavailableError';
  }
}

export async function getRedis(): Promise<any> {
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
      url: process.env.REDIS_URL || 'redis://localhost:6379',
      // Fail fast on connection issues
      socket: {
        connectTimeout: 3000,
        reconnectStrategy: false, // Disable auto-reconnect, fail fast
      },
    });

    client.on('error', (err) => {
      console.error('[Redis] Client error:', err);
    });

    await client.connect();
    return client;
  })();

  try {
    redisClient = await redisConnecting;
    return redisClient;
  } catch (error) {
    redisConnecting = null;
    console.error('[Redis] Connection failed:', error);
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
 * Lookup session by JTI
 * Returns null if session not found or Redis unavailable (fail-safe)
 */
export async function getSession(jti: string): Promise<{
  userId: string;
  role: 'administrator' | 'supervisor' | 'employee';
  ipHash: string;
  userAgent: string;
  refreshHash: string;
} | null> {
  try {
    const redis = await getRedis();
    const data = await redis.hGetAll(`session:${jti}`);

    if (!data || Object.keys(data).length === 0) return null;

    return {
      userId: data.userId,
      role: data.role as 'administrator' | 'supervisor' | 'employee',
      ipHash: data.ipHash,
      userAgent: data.userAgent,
      refreshHash: data.refreshHash,
    };
  } catch (error) {
    // Fail-safe: if Redis is unavailable, treat as session not found
    console.error('[getSession] Redis error, failing safe:', error);
    return null;
  }
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
  } catch (error) {
    console.error('[deleteSession] Redis error:', error);
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
  let redis;
  try {
    redis = await getRedis();
  } catch {
    console.error('[rotateRefreshToken] Redis unavailable, failing safe');
    return null;
  }

  const presentedHash = hashToken(presentedRefreshToken);

  // Find the refresh token for this user
  let keys: string[];
  try {
    keys = await redis.keys(`refresh:${userId}:*`);
  } catch {
    console.error('[rotateRefreshToken] Redis error during key lookup');
    return null;
  }

  let matchedKey: string | null = null;
  let matchedSession: { sessionId: string; used: string } | null = null;

  for (const key of keys) {
    const storedHash = key.split(':').pop();
    if (storedHash === presentedHash) {
      matchedKey = key;
      try {
        const data = await redis.hGetAll(key);
        if (data && Object.keys(data).length > 0) {
          matchedSession = { sessionId: data.sessionId, used: data.used };
        }
      } catch {
        console.error('[rotateRefreshToken] Redis error reading refresh token');
        return null;
      }
      break;
    }
  }

  if (!matchedKey || !matchedSession) {
    return null; // Invalid refresh token
  }

  // REUSE DETECTION: If token was already used, revoke entire session family
  if (matchedSession.used === 'true') {
    console.warn(`[Security] Refresh token reuse detected for user ${userId}, revoking all sessions`);
    try {
      await revokeAllUserSessions(userId);
    } catch {
      // Best effort
    }
    return null;
  }

  // Mark old refresh token as used
  try {
    await redis.hSet(matchedKey, 'used', 'true');
  } catch {
    console.error('[rotateRefreshToken] Redis error marking token used');
    return null;
  }

  // Get old session to retrieve role
  const oldSession = await getSession(matchedSession.sessionId);
  if (!oldSession) return null;

  // Delete old session
  try {
    await redis.del(`session:${matchedSession.sessionId}`);
  } catch {
    // Best effort
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
    return null;
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
    // Find all refresh tokens for this user
    const keys = await redis.keys(`refresh:${userId}:*`);
    for (const key of keys) {
      try {
        const data = await redis.hGetAll(key);
        if (data.sessionId) {
          await redis.del(`session:${data.sessionId}`);
        }
        await redis.del(key);
      } catch {
        // Best effort per-key
      }
    }
  } catch {
    console.error('[revokeAllUserSessions] Redis error during key iteration');
  }
}

/**
 * Rate limiting - returns true if allowed, false if rate limited
 * Uses simple counter with TTL (fixed window) for simplicity
 * Fail-open: if Redis unavailable, allow request (don't block users due to infra issues)
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
    console.error('[checkRateLimit] Redis unavailable, fail-open');
    return { allowed: true, remaining: maxRequests, resetAt: Date.now() + windowMs };
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
    console.error('[checkRateLimit] Redis error during operation, fail-open');
    return { allowed: true, remaining: maxRequests, resetAt: now + windowMs };
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