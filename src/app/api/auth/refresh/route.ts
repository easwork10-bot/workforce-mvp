import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { rotateRefreshToken, revokeAllUserSessions } from '@/backend/auth/session';
import { checkRateLimit } from '@/backend/auth/session';
import { generateCsrfToken, setCsrfCookie } from '@/backend/security/csrf';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limiting: 10 refresh attempts per minute per IP
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit(ip, 'refresh', 10, 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many refresh attempts' },
        { status: 429 }
      );
    }

    // Get refresh token from cookie
    const cookieHeader = req.headers.get('cookie');
    if (!cookieHeader) {
      return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
    }

    const refreshMatch = cookieHeader.match(/refresh_token=([^;]+)/);
    if (!refreshMatch) {
      return NextResponse.json({ error: 'No refresh token' }, { status: 401 });
    }

    const refreshToken = decodeURIComponent(refreshMatch[1]);
    const userAgent = req.headers.get('user-agent') || 'unknown';

    // Also verify the access token to get user ID (double-check)
    const payload = await verifyTokenFromCookie(cookieHeader);
    if (!payload) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    // Attempt to rotate the refresh token
    const result = await rotateRefreshToken(payload.sub, refreshToken, ip, userAgent);

    if (!result) {
      // Rotation failed - could be invalid token or reuse detected
      // In either case, revoke all sessions for this user
      await revokeAllUserSessions(payload.sub);

      const response = NextResponse.json(
        { error: 'Session expired or invalid. Please log in again.' },
        { status: 401 }
      );

      clearAuthCookies(response);
      return response;
    }

    // Success - set new cookies
    const response = NextResponse.json({
      user: {
        id: payload.sub,
        role: result.role,
      },
    });

    setAuthCookies(response, result.accessToken, result.refreshToken);

    // Set new CSRF token
    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken);

    return response;
  } catch (error) {
    console.error('[Refresh] Error:', error);
    return NextResponse.json(
      { error: 'Token refresh failed' },
      { status: 500 }
    );
  }
}

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.headers.get('x-real-ip') || '127.0.0.1';
}

function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  response.cookies.set('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
  });

  response.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: 30 * 24 * 60 * 60,
  });
}

function clearAuthCookies(response: NextResponse): void {
  response.cookies.set('access_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  response.cookies.set('refresh_token', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: 0,
  });
}