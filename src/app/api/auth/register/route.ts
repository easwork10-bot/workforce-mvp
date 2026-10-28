import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/backend/db';
import { profiles, userRoles } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import { hashPassword } from '@/backend/auth/passwords';
import { createTokenPair, hashIp } from '@/backend/auth/tokens';
import { createSession } from '@/backend/auth/session';
import { registerSchema } from '@/backend/validation/auth';
import { checkRateLimit } from '@/backend/auth/session';
import { decodeJwt } from '@/backend/auth/tokens';
import { generateCsrfToken, setCsrfCookie } from '@/backend/security/csrf';
import { logAuditEvent } from '@/backend/db/queries/audit';
import { getTrustedClientIp } from '@/backend/security/clientIp';

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Rate limiting: 5 registrations per minute per IP
    const ip = getTrustedClientIp(req);
    if (!ip) {
      return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }

    let rateLimit: Awaited<ReturnType<typeof checkRateLimit>>;
    try {
      rateLimit = await checkRateLimit(ip, 'register', 5, 60 * 1000);
    } catch {
      console.error('[Register] Rate limiter unavailable');
      return NextResponse.json({ error: 'Service temporarily unavailable' }, { status: 503 });
    }
    if (!rateLimit.allowed) {
      return NextResponse.json(
        { error: 'Too many registration attempts. Please try again later.' },
        { status: 429, headers: { 'Retry-After': Math.ceil((rateLimit.resetAt - Date.now()) / 1000).toString() } }
      );
    }

    // Parse and validate input
    const body = await req.json();
    const validation = registerSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { email, password, fullName, phone, city, preferredLanguage } = validation.data;

    // Check if user already exists
    const existing = await db.select().from(profiles).where(eq(profiles.email, email)).limit(1);
    if (existing.length > 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      );
    }

    // Hash password with Argon2id
    const passwordHash = await hashPassword(password);

    // Create user profile
    const userAgent = req.headers.get('user-agent') || 'unknown';
    const profile = await db.transaction(async (tx) => {
      const [createdProfile] = await tx
        .insert(profiles)
        .values({
          email,
          passwordHash,
          fullName,
          phone,
          city,
          preferredLanguage,
          accountStatus: 'active',
        })
        .returning();

      const [role] = await tx.insert(userRoles).values({
        userId: createdProfile.id,
        role: 'employee',
      }).returning();

      await logAuditEvent({
        actorId: createdProfile.id,
        action: 'INSERT',
        entityType: 'profiles',
        entityId: createdProfile.id,
        oldValues: null,
        newValues: { accountStatus: 'active' },
        ipAddress: hashIp(ip),
        userAgent,
      }, tx);

      await logAuditEvent({
        actorId: createdProfile.id,
        action: 'INSERT',
        entityType: 'user_roles',
        entityId: role.id,
        oldValues: null,
        newValues: { role: 'employee' },
        ipAddress: hashIp(ip),
        userAgent,
      }, tx);

      return createdProfile;
    });

    // Create initial session
    const { accessToken, refreshToken } = await createTokenPair(
      profile.id,
      'employee',
      ip
    );

    // Extract JTI from access token (decode without verification since we just created it)
    const jti = decodeJwt(accessToken).jti as string;

    await createSession(jti, profile.id, 'employee', ip, userAgent, refreshToken);

    // Build response with HttpOnly cookies
    const response = NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        role: 'employee',
        preferredLanguage: profile.preferredLanguage,
      },
    });

    setAuthCookies(response, accessToken, refreshToken);

    // Set CSRF token cookie
    const csrfToken = generateCsrfToken();
    setCsrfCookie(response, csrfToken);

    return response;
  } catch (error) {
    console.error('[Register] Error:', error);
    return NextResponse.json(
      { error: 'Registration failed. Please try again.' },
      { status: 500 }
    );
  }
}

function setAuthCookies(
  response: NextResponse,
  accessToken: string,
  refreshToken: string
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  // Access token: 15 min, accessible to all paths
  response.cookies.set('access_token', accessToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 15 * 60,
  });

  // Refresh token: 30 days, only sent to refresh endpoint
  response.cookies.set('refresh_token', refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/api/auth/refresh',
    maxAge: 30 * 24 * 60 * 60,
  });
}