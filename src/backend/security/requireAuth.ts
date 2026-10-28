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

  return {
    userId: session.userId,
    role: session.role,
    jti: payload.jti,
  };
}
