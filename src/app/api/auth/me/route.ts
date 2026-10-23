import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/backend/db';
import { profiles } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { getSession } from '@/backend/auth/session';

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify access token from cookie
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));

    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify session in Redis
    const session = await getSession(payload.jti);
    if (!session) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 });
    }

    // Get fresh profile data
    const [profile] = await db
      .select({
        id: profiles.id,
        email: profiles.email,
        fullName: profiles.fullName,
        phone: profiles.phone,
        city: profiles.city,
        preferredLanguage: profiles.preferredLanguage,
        accountStatus: profiles.accountStatus,
        avatarUrl: profiles.avatarUrl,
      })
      .from(profiles)
      .where(eq(profiles.id, session.userId))
      .limit(1);

    if (!profile) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    if (profile.accountStatus !== 'active') {
      return NextResponse.json({ error: 'Account not active' }, { status: 403 });
    }

    return NextResponse.json({
      user: {
        id: profile.id,
        email: profile.email,
        fullName: profile.fullName,
        phone: profile.phone,
        city: profile.city,
        preferredLanguage: profile.preferredLanguage,
        avatarUrl: profile.avatarUrl,
        role: session.role,
      },
    });
  } catch (error) {
    console.error('[Me] Error:', error);
    return NextResponse.json({ error: 'Failed to get user' }, { status: 500 });
  }
}