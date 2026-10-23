import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/backend/db';
import { profiles, userRoles } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import { verifyPassword } from '@/backend/auth/passwords';
import { createTokenPair } from '@/backend/auth/tokens';
import { createSession } from '@/backend/auth/session';
import { loginSchema } from '@/lib/validators/auth';
import { checkRateLimit } from '@/backend/auth/session';
import { decodeJwt } from '@/backend/auth/tokens';
import { generateCsrfToken, setCsrfCookie } from '@/backend/security/csrf';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limiting: 5 login attempts per minute per IP
    const ip = getClientIp(req);
    const rateLimit = await checkRateLimit(ip, 'login', 5, 60 * 1000);
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString() } }
      );
    }

    // Parse and validate input
    const body = await req.json();
    const validation = loginSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password } = validation.data;

    // Find user by email
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.email, email))
      .limit(1);

    if (!profile || !profile.passwordHash) {
      // Use constant-time verification to prevent timing attacks
      await verifyPassword(password, '$argon2id$v=19$m=65536,t=3,p=2$dummy$salt');
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Verify password
    const validPassword = await verifyPassword(password, profile.passwordHash);
    if (!validPassword) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      );
    }

    // Check account status
    if (profile.accountStatus !== 'active') {
      return NextResponse.json(
        { error: 'Account is not active' },
        { status: 403 }
      );
    }

    // Get user role
    const [roleData] = await db
      .select({ role: userRoles.role })
      .from(userRoles)
      .where(eq(userRoles.userId, profile.id))
      .limit(1);

    const role = roleData?.role || 'employee';

    // Create session tokens
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const { accessToken, refreshToken } = await createTokenPair(profile.id, role, ip);

    // Extract JTI from access token (decode without verification since we just created it)
    const jti = decodeJwt(accessToken).jti as string;

    await createSession(jti, profile.id, role, ip, userAgent, refreshToken);

    // Build response
    const response = NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role,
        preferredLanguage: profile.preferredLanguage,
      },
    });

    setAuthCookies(response, accessToken, refreshToken);

    // Set CSRF token cookie
    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken);

    return response;
  } catch (error) {
    console.error('[Login] Error:', error);
    return NextResponse.json(
      { error: 'Login failed. Please try again.' },
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