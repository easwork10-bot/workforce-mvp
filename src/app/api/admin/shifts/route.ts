import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/backend/auth/session';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { createShiftSchema } from '@/lib/validators/shifts';
import { createShift, getShifts } from '@/backend/db/queries/shifts';
import { db } from '@/backend/db';
import { profiles } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import { requireCsrf } from '@/backend/security/csrf';
import { getAuditMetadata } from '@/backend/security/auditLogger';

/**
 * GET /api/admin/shifts - Get all shifts (admin only)
 */
async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));
    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify admin role
    const session = await getSession(payload.jti);
    if (!session || session.role !== 'administrator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Get all shifts using the query function
    const result = await getShifts({ limit: 100 });
    const shiftsWithCreators = result.data;

    return NextResponse.json({ shifts: shiftsWithCreators });
  } catch (error) {
    console.error('[Admin Shifts GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shifts' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/shifts - Create a new shift (admin only)
 */
async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication
    const payload = await verifyTokenFromCookie(req.headers.get('cookie'));
    if (!payload) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    // Verify admin role
    const session = await getSession(payload.jti);
    if (!session || session.role !== 'administrator') {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Parse and validate input
    const body = await req.json();
    const validation = createShiftSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Get the admin's profile
    const [profile] = await db
      .select()
      .from(profiles)
      .where(eq(profiles.id, payload.sub))
      .limit(1);

    if (!profile) {
      return NextResponse.json(
        { error: 'User profile not found' },
        { status: 404 }
      );
    }

    // Create the shift
    const shift = await createShift({
      ...validation.data,
      startAt: new Date(validation.data.startAt),
      endAt: new Date(validation.data.endAt),
      latitude: validation.data.latitude ? validation.data.latitude.toString() : null,
      longitude: validation.data.longitude ? validation.data.longitude.toString() : null,
      compensationAmount: validation.data.compensationAmount ? validation.data.compensationAmount.toString() : null,
      createdBy: profile.id,
      status: 'draft', // Start as draft
    }, getAuditMetadata(req));

    return NextResponse.json({
      shift,
      message: 'Shift created successfully',
    });
  } catch (error) {
    console.error('[Admin Shifts POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to create shift' },
      { status: 500 }
    );
  }
}

// Wrap POST with CSRF protection (GET doesn't need it)
const protectedPOST = requireCsrf(POST);

export { GET, protectedPOST as POST };