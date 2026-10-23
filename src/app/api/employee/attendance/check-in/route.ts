import { NextRequest, NextResponse } from 'next/server';
import { checkInCore } from '@/backend/services/attendance';
import { checkInSchema } from '@/backend/validation/attendance';
import { requireRole } from '@/backend/security/requireRole';
import { db } from '@/backend/db';
import { shiftAssignments } from '@/backend/db/schema';
import { eq, and } from 'drizzle-orm';
import { withCsrfAndAuth } from '@/backend/security/csrf';
import { getAuditMetadata } from '@/backend/security/auditLogger';

/**
 * POST /api/employee/attendance/check-in - Check in for a shift assignment (employee)
 */
async function checkInHandler(req: NextRequest): Promise<NextResponse> {
  try {
    // Authentication already verified by withCsrfAndAuth wrapper
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;

    // Parse and validate body
    const body = await req.json();
    const validation = checkInSchema.safeParse(body);

    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { shiftAssignmentId, latitude, longitude } = validation.data;

    // Verify the assignment belongs to this employee
    const [assignment] = await db
      .select({
        id: shiftAssignments.id,
        employeeId: shiftAssignments.employeeId,
        status: shiftAssignments.status,
      })
      .from(shiftAssignments)
      .where(and(
        eq(shiftAssignments.id, shiftAssignmentId),
        eq(shiftAssignments.employeeId, userId)
      ))
      .limit(1);

    if (!assignment) {
      return NextResponse.json(
        { error: 'Dienst niet gevonden of geen toegang' },
        { status: 400 }
      );
    }

    if (assignment.status !== 'assigned' && assignment.status !== 'confirmed') {
      return NextResponse.json(
        { error: 'Kan niet inchecken voor deze dienst' },
        { status: 400 }
      );
    }

    // Check in using shared service
    const result = await checkInCore(shiftAssignmentId, latitude ?? null, longitude ?? null, userId, getAuditMetadata(req));

    if (!result.success) {
      return NextResponse.json(
        { error: result.message },
        { status: 400 }
      );
    }

    return NextResponse.json({
      message: result.message,
      record: result.record,
    });
  } catch (error) {
    console.error('[Employee Check-in POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check in' },
      { status: 500 }
    );
  }
}

// Wrap with CSRF protection and authentication
export const POST = withCsrfAndAuth(checkInHandler, ['employee']);