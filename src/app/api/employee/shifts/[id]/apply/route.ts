import { NextRequest, NextResponse } from 'next/server';
import { applyForShiftWithLock } from '@/lib/db/queries/applications';
import { applyShiftSchema } from '@/lib/validators/applications';
import { requireRole } from '@/lib/middleware/requireRole';
import { withCsrfAndAuth } from '@/lib/middleware/csrf';

/**
 * POST /api/employee/shifts/[id]/apply - Apply for a shift with concurrency lock
 */
async function applyShiftHandler(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    // Authentication already verified by withCsrfAndAuth wrapper
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;
    const { id } = await params;

    // Validate shift ID
    const validation = applyShiftSchema.safeParse({ shiftId: id });
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid shift ID', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    // Apply with Redis lock for concurrency protection
    const result = await applyForShiftWithLock(validation.data.shiftId, userId);

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: result.message,
      applicationId: result.applicationId,
    });
  } catch (error) {
    console.error('[Employee Shift Apply POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to apply for shift' },
      { status: 500 }
    );
  }
}

// Wrap with CSRF protection and authentication
export const POST = withCsrfAndAuth(applyShiftHandler, ['employee']);