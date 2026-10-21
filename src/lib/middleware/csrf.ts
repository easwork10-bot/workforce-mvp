import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHmac } from 'crypto';

const CSRF_COOKIE_NAME = 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_SECRET = process.env.CSRF_SECRET || 'development-csrf-secret-change-in-production';

/**
 * Generate a cryptographically secure CSRF token
 */
export function generateCsrfToken(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Create a signed CSRF token (token + HMAC signature)
 */
export function signCsrfToken(token: string): string {
  const signature = createHmac('sha256', CSRF_SECRET).update(token).digest('base64url');
  return `${token}.${signature}`;
}

/**
 * Verify a signed CSRF token and return the raw token if valid
 */
export function verifyCsrfToken(signedToken: string): string | null {
  const parts = signedToken.split('.');
  if (parts.length !== 2) return null;

  const [token, signature] = parts;
  const expectedSignature = createHmac('sha256', CSRF_SECRET).update(token).digest('base64url');

  // Constant-time comparison
  if (signature.length !== expectedSignature.length) return null;
  let mismatch = 0;
  for (let i = 0; i < signature.length; i++) {
    mismatch |= signature.charCodeAt(i) ^ expectedSignature.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  return token;
}

/**
 * Get raw CSRF token from request cookie (unsigned, for token endpoint)
 * This reads the cookie directly from NextRequest.cookies
 */
export function getRawCsrfTokenFromCookie(req: NextRequest): string | null {
  const cookie = req.cookies.get(CSRF_COOKIE_NAME);
  if (!cookie) return null;
  // Return the signed token as-is (the token endpoint will extract raw)
  return cookie.value;
}

/**
 * Set CSRF cookie on response (HttpOnly for security)
 * The raw token is delivered to frontend via a separate /api/auth/csrf endpoint
 */
export function setCsrfCookie(response: NextResponse, token: string): void {
  const isProduction = process.env.NODE_ENV === 'production';
  const signedToken = signCsrfToken(token);

  response.cookies.set(CSRF_COOKIE_NAME, signedToken, {
    httpOnly: true, // Secure: not readable by JavaScript
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 15 * 60, // 15 minutes - same as access token
  });
}

/**
 * Clear CSRF cookie
 */
export function clearCsrfCookie(response: NextResponse): void {
  const isProduction = process.env.NODE_ENV === 'production';
  response.cookies.set(CSRF_COOKIE_NAME, '', {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/',
    maxAge: 0,
  });
}

/**
 * Get CSRF token from request cookie and verify signature
 */
export function getCsrfTokenFromCookie(req: NextRequest): string | null {
  const cookieHeader = req.headers.get('cookie');
  if (!cookieHeader) return null;

  const match = cookieHeader.match(new RegExp(`${CSRF_COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const signedToken = decodeURIComponent(match[1]);
  return verifyCsrfToken(signedToken);
}

/**
 * Get CSRF token from request header and verify signature
 */
export function getCsrfTokenFromHeader(req: NextRequest): string | null {
  const headerToken = req.headers.get(CSRF_HEADER_NAME);
  if (!headerToken) return null;
  return verifyCsrfToken(headerToken);
}

/**
 * Middleware to require valid CSRF token for state-changing requests
 * Uses double-submit cookie pattern: token in cookie (HttpOnly, verified server-side) must match token in header
 */
export function requireCsrf(
  handler: (req: NextRequest, ...args: any[]) => Promise<NextResponse>
) {
  return async (req: NextRequest, ...args: any[]): Promise<NextResponse> => {
    // Only check CSRF for state-changing methods
    const method = req.method.toUpperCase();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return handler(req, ...args);
    }

    // Get CSRF token from cookie (set by server, HttpOnly, verified server-side)
    const cookieToken = getCsrfTokenFromCookie(req);
    // Get CSRF token from header (sent by client)
    const headerToken = getCsrfTokenFromHeader(req);

    // Both must exist, be valid (verified signature), and match
    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
      return NextResponse.json(
        { error: 'Invalid or missing CSRF token' },
        { status: 403 }
      );
    }

    return handler(req, ...args);
  };
}

/**
 * Higher-order function to wrap API route handlers with CSRF protection + auth
 */
export function withCsrfAndAuth<T extends any[]>(
  handler: (req: NextRequest, ...args: T) => Promise<NextResponse>,
  allowedRoles?: ('administrator' | 'supervisor' | 'employee')[]
) {
  return async (req: NextRequest, ...args: T): Promise<NextResponse> => {
    // First check CSRF
    const method = req.method.toUpperCase();
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      const cookieToken = getCsrfTokenFromCookie(req);
      const headerToken = getCsrfTokenFromHeader(req);

      if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return NextResponse.json(
          { error: 'Invalid or missing CSRF token' },
          { status: 403 }
        );
      }
    }

    // Then check auth if roles specified
    if (allowedRoles) {
      const { requireAuth } = await import('./requireAuth');

      const authResult = await requireAuth(req);
      if (authResult instanceof NextResponse) {
        return authResult;
      }

      if (!allowedRoles.includes(authResult.role)) {
        return NextResponse.json(
          { error: 'Insufficient permissions' },
          { status: 403 }
        );
      }

      const authReq = req as any;
      authReq.auth = authResult;
    }

    return handler(req, ...args);
  };
}