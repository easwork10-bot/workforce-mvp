import { NextRequest, NextResponse } from 'next/server';
import { getEmployeeSchedule } from '@/lib/db/queries/assignments';
import { attendanceQuerySchema } from '@/lib/validators/attendance';
import { requireRole } from '@/lib/middleware/requireRole';

/**
 * GET /api/employee/schedule - Get employee's schedule (upcoming and past assignments)
 */
async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // Verify authentication and employee role
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;

    // Parse and validate query parameters
    const { searchParams } = new URL(req.url);
    const validation = attendanceQuerySchema.safeParse({
      shiftId: searchParams.get('shiftId') || undefined,
      employeeId: searchParams.get('employeeId') || undefined,
      status: searchParams.get('status') || undefined,
      dateFrom: searchParams.get('dateFrom') || undefined,
      dateTo: searchParams.get('dateTo') || undefined,
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Employee can only see their own schedule
    const { data, total } = await getEmployeeSchedule({
      employeeId: userId,
      startFrom: validation.data.dateFrom,
      startTo: validation.data.dateTo,
      status: validation.data.status,
      page: validation.data.page,
      limit: validation.data.limit,
    });

    return NextResponse.json({
      assignments: data,
      pagination: {
        page: validation.data.page,
        limit: validation.data.limit,
        total,
        totalPages: Math.ceil(total / validation.data.limit),
      },
    });
  } catch (error) {
    console.error('[Employee Schedule GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch schedule' },
      { status: 500 }
    );
  }
}

export { GET };