import { db } from '..';
import { attendanceRecords, shiftAssignments } from '../schema';
import { eq, and, desc, count, gte, lte, or } from 'drizzle-orm';
import type { AttendanceRecord } from '../schema';

/**
 * Get attendance records with filtering
 */
export async function getAttendanceRecords({
  assignmentId,
  startDate,
  endDate,
  page = 1,
  limit = 20,
}: {
  assignmentId?: string;
  startDate?: string;
  endDate?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: AttendanceRecord[]; total: number }> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (assignmentId) {
    conditions.push(eq(attendanceRecords.shiftAssignmentId, assignmentId));
  }

  if (startDate) {
    conditions.push(gte(attendanceRecords.createdAt, new Date(startDate)));
  }

  if (endDate) {
    conditions.push(lte(attendanceRecords.createdAt, new Date(endDate)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(attendanceRecords)
    .where(whereClause);

  const data = await db
    .select()
    .from(attendanceRecords)
    .where(whereClause)
    .orderBy(desc(attendanceRecords.createdAt))
    .limit(limit)
    .offset(offset);

  return { data, total };
}

/**
 * Check in or check out for a shift assignment
 */
export async function upsertAttendance(
  assignmentId: string,
  action: 'check_in' | 'check_out',
  latitude: number,
  longitude: number,
  approvedBy?: string
): Promise<AttendanceRecord> {
  const now = new Date();

  if (action === 'check_in') {
    // Check if already checked in today
    const existing = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.shiftAssignmentId, assignmentId),
          eq(attendanceRecords.attendanceStatus, 'checked_in')
        )
      )
      .limit(1);

    if (existing.length > 0) {
      throw new Error('Already checked in for this assignment');
    }

    const [record] = await db
      .insert(attendanceRecords)
      .values({
        shiftAssignmentId: assignmentId,
        checkInAt: now,
        checkInLatitude: latitude.toString(),
        checkInLongitude: longitude.toString(),
        attendanceStatus: 'checked_in',
      })
      .returning();

    return record;
  } else {
    // Check out
    const [record] = await db
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.shiftAssignmentId, assignmentId),
          or(
            eq(attendanceRecords.attendanceStatus, 'checked_in'),
            eq(attendanceRecords.attendanceStatus, 'late')
          )
        )
      )
      .orderBy(desc(attendanceRecords.createdAt))
      .limit(1);

    if (!record) {
      throw new Error('No active check-in record found for this assignment');
    }

    const [updated] = await db
      .update(attendanceRecords)
      .set({
        checkOutAt: now,
        checkOutLatitude: latitude.toString(),
        checkOutLongitude: longitude.toString(),
        attendanceStatus: 'checked_out',
        approvedBy,
        approvedAt: now,
      })
      .where(eq(attendanceRecords.id, record.id))
      .returning();

    return updated;
  }
}

/**
 * Employee check-in - validates ownership of the assignment
 */
export async function employeeCheckIn(
  employeeId: string,
  assignmentId: string,
  latitude: number | null,
  longitude: number | null
): Promise<{ success: boolean; message: string; record?: AttendanceRecord }> {
  // Verify the assignment belongs to this employee
  const [assignment] = await db
    .select({
      id: shiftAssignments.id,
      employeeId: shiftAssignments.employeeId,
      shiftId: shiftAssignments.shiftId,
      status: shiftAssignments.status,
    })
    .from(shiftAssignments)
    .where(and(
      eq(shiftAssignments.id, assignmentId),
      eq(shiftAssignments.employeeId, employeeId)
    ))
    .limit(1);

  if (!assignment) {
    return { success: false, message: 'Dienst niet gevonden of geen toegang' };
  }

  if (assignment.status !== 'assigned' && assignment.status !== 'confirmed') {
    return { success: false, message: 'Kan niet inchecken voor deze dienst' };
  }

  // Check if already checked in
  const existing = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.shiftAssignmentId, assignmentId),
        eq(attendanceRecords.attendanceStatus, 'checked_in')
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { success: false, message: 'Al ingecheckt voor deze dienst' };
  }

  const now = new Date();
  const [record] = await db
    .insert(attendanceRecords)
    .values({
      shiftAssignmentId: assignmentId,
      checkInAt: now,
      checkInLatitude: latitude != null ? latitude.toString() : null,
      checkInLongitude: longitude != null ? longitude.toString() : null,
      attendanceStatus: 'checked_in',
    })
    .returning();

  // Update assignment status to confirmed if it was just assigned
  if (assignment.status === 'assigned') {
    await db
      .update(shiftAssignments)
      .set({ status: 'confirmed', confirmedAt: now })
      .where(eq(shiftAssignments.id, assignmentId));
  }

  return { success: true, message: 'Inchecken succesvol', record };
}

/**
 * Employee check-out - validates ownership of the assignment
 */
export async function employeeCheckOut(
  employeeId: string,
  assignmentId: string,
  latitude: number | null,
  longitude: number | null
): Promise<{ success: boolean; message: string; record?: AttendanceRecord }> {
  // Verify the assignment belongs to this employee
  const [assignment] = await db
    .select({
      id: shiftAssignments.id,
      employeeId: shiftAssignments.employeeId,
      shiftId: shiftAssignments.shiftId,
      status: shiftAssignments.status,
    })
    .from(shiftAssignments)
    .where(and(
      eq(shiftAssignments.id, assignmentId),
      eq(shiftAssignments.employeeId, employeeId)
    ))
    .limit(1);

  if (!assignment) {
    return { success: false, message: 'Dienst niet gevonden of geen toegang' };
  }

  // Find active check-in record
  const [record] = await db
    .select()
    .from(attendanceRecords)
    .where(
      and(
        eq(attendanceRecords.shiftAssignmentId, assignmentId),
        or(
          eq(attendanceRecords.attendanceStatus, 'checked_in'),
          eq(attendanceRecords.attendanceStatus, 'late')
        )
      )
    )
    .orderBy(desc(attendanceRecords.createdAt))
    .limit(1);

  if (!record) {
    return { success: false, message: 'Geen actieve inchecken gevonden voor deze dienst' };
  }

  const now = new Date();
  const [updated] = await db
    .update(attendanceRecords)
    .set({
      checkOutAt: now,
      checkOutLatitude: latitude != null ? latitude.toString() : null,
      checkOutLongitude: longitude != null ? longitude.toString() : null,
      attendanceStatus: 'checked_out',
      approvedAt: now,
    })
    .where(eq(attendanceRecords.id, record.id))
    .returning();

  return { success: true, message: 'Uitchecken succesvol', record: updated };
}