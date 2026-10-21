import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { verifyTokenFromCookie } from '@/lib/auth/tokens';
import { getAttendanceRecords } from '@/lib/db/queries/attendance';

/**
 * GET /api/admin/attendance - Get attendance records overview (admin only)
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
    const assignmentId = searchParams.get('assignmentId') || undefined;
    const startDate = searchParams.get('startDate') || undefined;
    const endDate = searchParams.get('endDate') || undefined;

    // Get attendance records
    const { data, total } = await getAttendanceRecords({
      assignmentId,
      startDate,
      endDate,
      page: 1,
      limit: 100,
    });

    return NextResponse.json({
      records: data,
      pagination: {
        page: 1,
        limit: 100,
        total,
        totalPages: 1,
      },
    });
  } catch (error) {
    console.error('[Admin Attendance GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch attendance records' },
      { status: 500 }
    );
  }
}

export { GET };