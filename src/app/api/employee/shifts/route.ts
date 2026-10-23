import { NextRequest, NextResponse } from 'next/server';
import { getAvailableShiftsForEmployee } from '@/backend/db/queries/shifts';
import { shiftQuerySchema } from '@/lib/validators/shifts';
import { requireRole } from '@/backend/security/requireRole';

/**
 * GET /api/employee/shifts - Get available shifts for the authenticated employee
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
    const validation = shiftQuerySchema.safeParse({
      status: searchParams.get('status') || undefined,
      workType: searchParams.get('workType') || undefined,
      startFrom: searchParams.get('startFrom') || undefined,
      startTo: searchParams.get('startTo') || undefined,
      page: searchParams.get('page') || undefined,
      limit: searchParams.get('limit') || undefined,
      sortBy: searchParams.get('sortBy') || undefined,
      sortOrder: searchParams.get('sortOrder') || undefined,
    });

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid query parameters', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // For employees, we only show open shifts
    const { data, total } = await getAvailableShiftsForEmployee({
      employeeId: userId,
      workType: validation.data.workType,
      startFrom: validation.data.startFrom,
      startTo: validation.data.startTo,
      page: validation.data.page,
      limit: validation.data.limit,
    });

    return NextResponse.json({
      shifts: data,
      pagination: {
        page: validation.data.page,
        limit: validation.data.limit,
        total,
        totalPages: Math.ceil(total / validation.data.limit),
      },
    });
  } catch (error) {
    console.error('[Employee Shifts GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shifts' },
      { status: 500 }
    );
  }
}

export { GET };