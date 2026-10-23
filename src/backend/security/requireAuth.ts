import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { getSession, RedisUnavailableError } from '@/backend/auth/session';

export interface AuthenticatedRequest extends NextRequest {
  auth: {
    userId: string;
    role: 'administrator' | 'supervisor' | 'employee';
    jti: string;
  };
}

/**
 * Middleware to require valid authentication
 * Verifies JWT from cookie and validates session in Redis
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ userId: string; role: 'administrator' | 'supervisor' | 'employee'; jti: string } | NextResponse> {
  // Extract access token from cookie
  const payload = await verifyTokenFromCookie(req.headers.get('cookie'));

  if (!payload) {
    return NextResponse.json(
      { error: 'Authentication required' },
      { status: 401 }
    );
  }

  // Verify session exists in Redis
  let session;
  try {
    session = await getSession(payload.jti);
  } catch (error) {
    if (error instanceof RedisUnavailableError) {
      console.error('[requireAuth] Redis unavailable, failing safe');
      return NextResponse.json(
        { error: 'Authentication service temporarily unavailable' },
        { status: 503 }
      );
    }
    throw error;
  }

  if (!session) {
    return NextResponse.json(
      { error: 'Session expired or revoked' },
      { status: 401 }
    );
  }

  // Verify IP binding (optional - can be strict or lenient)
  // For now we log but don't reject on IP mismatch to handle mobile networks
  // const currentIpHash = hashIp(getClientIp(req));
  // if (currentIpHash !== session.ipHash) {
  //   console.warn(`[Security] IP mismatch for session ${payload.jti}`);
  // }

  return {
    userId: session.userId,
    role: session.role,
    jti: payload.jti,
  };
}

/**
 * Extract client IP from request
 */
export function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) {
    return forwarded.split(',')[0].trim();
  }
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

/**
 * Higher-order function to wrap API route handlers with auth
 */
export function withAuth<T extends any[]>(
  handler: (req: AuthenticatedRequest, ...args: T) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: T): Promise<NextResponse> => {
    const authResult = await requireAuth(req);

    if (authResult instanceof NextResponse) {
      return authResult;
    }

    // Attach auth to request
    const authReq = req as AuthenticatedRequest;
    authReq.auth = authResult;

    return handler(authReq, ...args);
  };
}