import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getApplications } from '@/lib/db/queries/applications';
import { reviewApplication } from '@/lib/db/queries/applications';
import { requireCsrf } from '@/lib/middleware/csrf';

/**
 * GET /api/admin/applications - Get all shift applications (admin only)
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

    // Parse query parameters
    const { searchParams } = new URL(req.url);
    const shiftId = searchParams.get('shiftId') || undefined;
    const employeeId = searchParams.get('employeeId') || undefined;
    const status = searchParams.get('status') || undefined;

    // Get applications
    const { data, total } = await getApplications({
      shiftId,
      employeeId,
      status,
      page: 1,
      limit: 100,
    });

    return NextResponse.json({
      applications: data,
      pagination: {
        page: 1,
        limit: 100,
        total,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error('[Admin Applications GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch applications' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/applications/[id]/review - Review a shift application (accept/reject)
 */
async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<NextResponse> {
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

    const { id } = params;
    const body = await req.json();

    const { status, rejectionReason } = body;

    if (!['accepted', 'rejected'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be "accepted" or "rejected"' },
        { status: 400 }
      );
    }

    const result = await reviewApplication(id, payload.sub, status, rejectionReason);

    if (!result.success) {
      const statusCode = result.message === 'Sollicitatie niet gevonden' ? 404 : 400;
      return NextResponse.json(
        { error: result.message },
        { status: statusCode }
      );
    }

    return NextResponse.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    console.error('[Admin Applications POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to review application' },
      { status: 500 }
    );
  }
}

// Wrap POST with CSRF protection (GET doesn't need it)
const protectedPOST = requireCsrf(POST);

export { GET, protectedPOST as POST };