import { NextRequest, NextResponse } from 'next/server';
import { checkOutCore } from '@/lib/services/attendance';
import { checkOutSchema } from '@/lib/validators/attendance';
import { requireRole } from '@/lib/middleware/requireRole';
import { db } from '@/lib/db';
import { shiftAssignments, attendanceRecords } from '@/lib/db/schema';
import { eq, and, or, desc } from 'drizzle-orm';
import { withCsrfAndAuth } from '@/lib/middleware/csrf';
import { getAuditMetadata } from '@/lib/middleware/auditLogger';

/**
 * POST /api/employee/attendance/check-out - Check out for a shift assignment (employee)
 */
async function checkOutHandler(req: NextRequest): Promise<NextResponse> {
  try {
    // Authentication already verified by withCsrfAndAuth wrapper
    const authResult = await requireRole(req, ['employee']);
    if (authResult instanceof NextResponse) {
      return authResult;
    }

    const { userId } = authResult;

    // Parse and validate body
    const body = await req.json();
    const validation = checkOutSchema.safeParse(body);

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

    // Verify there's an active check-in record for this assignment
    const [existingRecord] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.shiftAssignmentId, shiftAssignmentId),
          or(
            eq(attendanceRecords.attendanceStatus, 'checked_in'),
            eq(attendanceRecords.attendanceStatus, 'late')
          )
        )
      )
      .orderBy(desc(attendanceRecords.createdAt))
      .limit(1);

    if (!existingRecord) {
      return NextResponse.json(
        { error: 'Geen actieve inchecken gevonden voor deze dienst' },
        { status: 400 }
      );
    }

    // Check out using shared service
    const result = await checkOutCore(shiftAssignmentId, latitude ?? null, longitude ?? null, userId, getAuditMetadata(req));

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
    console.error('[Employee Check-out POST] Error:', error);
    return NextResponse.json(
      { error: 'Failed to check out' },
      { status: 500 }
    );
  }
}

// Wrap with CSRF protection and authentication
export const POST = withCsrfAndAuth(checkOutHandler, ['employee']);