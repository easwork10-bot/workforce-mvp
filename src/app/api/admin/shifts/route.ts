import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/backend/auth/session';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { createShiftSchema } from '@/backend/validation/shifts';
import { createShift, getShiftStats, getShifts } from '@/backend/db/queries/shifts';
import { db } from '@/backend/db';
import { profiles } from '@/backend/db/schema';
import { eq } from 'drizzle-orm';
import { requireCsrf } from '@/backend/security/csrf';
import { getAuditMetadata } from '@/backend/security/auditLogger';
import { shiftQuerySchema } from '@/backend/validation/shifts';

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

    const query = shiftQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams.entries())
    );
    if (!query.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: query.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const [result, stats] = await Promise.all([
      getShifts(query.data),
      getShiftStats(),
    ]);
    const totalPages = Math.ceil(result.total / query.data.limit);

    return NextResponse.json({
      shifts: result.data,
      pagination: {
        page: query.data.page,
        limit: query.data.limit,
        total: result.total,
        totalPages,
      },
      stats,
    });
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
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
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
      latitude: validation.data.latitude != null ? validation.data.latitude.toString() : null,
      longitude: validation.data.longitude != null ? validation.data.longitude.toString() : null,
      compensationAmount: validation.data.compensationAmount != null
        ? validation.data.compensationAmount.toString()
        : null,
      createdBy: profile.id,
      status: 'draft', // Start as draft
    }, getAuditMetadata(req));

    return NextResponse.json({
      shift,
      message: 'Shift created successfully',
    }, { status: 201 });
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