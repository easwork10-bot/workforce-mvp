import { NextRequest, NextResponse } from 'next/server';
import { getShiftDetailsForEmployee } from '@/backend/db/queries/shifts';
import { shiftIdParamSchema } from '@/lib/validators/shifts';
import { requireRole } from '@/backend/security/requireRole';

/**
 * GET /api/employee/shifts/[id] - Get shift details for the authenticated employee
 */
async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Verify authentication and employee role
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const { id } = await params;

    // Validate shift ID
    const validation = shiftIdParamSchema.safeParse({ id });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid shift ID', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const shift = await getShiftDetailsForEmployee(validation.data.id, userId);

    if (!shift) {
      return NextResponse.json(
        { error: 'Shift not found or not available' },
        { status: 404 }
      );
    }

    return NextResponse.json({ shift });
  } catch (error) {
    console.error('[Employee Shift Detail GET] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch shift details' },
      { status: 500 }
    );
  }
}

export { GET };