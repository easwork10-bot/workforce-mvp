import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/backend/auth/session';
import { verifyTokenFromCookie } from '@/backend/auth/tokens';
import { getApplications } from '@/backend/db/queries/applications';

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

export { GET };