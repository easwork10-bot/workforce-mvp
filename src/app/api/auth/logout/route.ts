import { NextRequest, NextResponse } from 'next/server';
import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getSession, deleteSession, revokeAllUserSessions } from '@/lib/auth/session';
import { requireCsrf, clearCsrfCookie } from '@/lib/middleware/csrf';

async function logoutHandler(req: NextRequest): Promise<NextResponse> {
  try {
    // Extract access token from cookie
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));

    if (payload) {
      // Get session to find refresh token hash
      const session = await getSession(payload.jti);

      if (session) {
        // Delete this specific session
        await deleteSession(payload.jti, session.userId, session.refreshHash);
      } else {
        // Session not found, but try to revoke all user sessions as safety
        await revokeAllUserSessions(payload.sub);
      }
    }

    // Clear cookies
    const response = NextResponse.json({ success: true });

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

    // Also clear CSRF cookie
    clearCsrfCookie(response);

    return response;
  } catch (error) {
    console.error('[Logout] Error:', error);
    // Even on error, clear cookies
    const response = NextResponse.json({ success: true });
    response.cookies.set('access_token', '', { maxAge: 0, path: '/' });
    response.cookies.set('refresh_token', '', { maxAge: 0, path: '/api/auth/refresh' });
    clearCsrfCookie(response);
    return response;
  }
}

// Wrap with CSRF protection (logout is a state-changing operation)
export const POST = requireCsrf(logoutHandler);