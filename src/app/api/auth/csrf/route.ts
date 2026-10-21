import { NextRequest, NextResponse } from 'next/server';
import { getCsrfTokenFromCookie, generateCsrfToken, signCsrfToken } from '@/lib/middleware/csrf';

/**
 * GET /api/auth/csrf - Get CSRF token for frontend JavaScript
 *
 * This endpoint returns the raw CSRF token to legitimate frontend code.
 * The cookie itself is HttpOnly for security, but this endpoint allows
 * same-origin frontend JavaScript to obtain the token for double-submit pattern.
 *
 * Security: This endpoint must be same-origin and same-session to prevent
 * cross-site token extraction.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Get the raw token from cookie (if exists)
    const cookieToken = getCsrfTokenFromCookie(req);

    if (cookieToken) {
      // Token exists in cookie, return it
      return NextResponse.json({ csrfToken: cookieToken });
    }

    // No token exists yet - generate and set a new one
    // This handles edge cases where token expired but session is valid
    const newToken = generateCsrfToken();
    const signedToken = signCsrfToken(newToken);

    const response = NextResponse.json({ csrfToken: newToken });

    // Set the HttpOnly cookie with signed token
    const isProduction = process.env.NODE_ENV === 'production';
    response.cookies.set('csrf_token', signedToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/',
      maxAge: 15 * 60, // 15 minutes
    });

    return response;
  } catch (error) {
    console.error('[CSRF Token GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to get CSRF token' },
      { status: 500 }
    );
  }
}