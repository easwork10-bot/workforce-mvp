import { db } from '@/lib/db';
import { attendanceRecords, shiftAssignments } from '@/lib/db/schema';
import { eq, and, desc, or } from 'drizzle-orm';
import type { AttendanceRecord } from '@/lib/db/schema';

/**
 * Core attendance service - shared logic for check-in/out operations
 * Does NOT include authorization/ownership checks - those are handled by route layers
 */
export async function checkInCore(
  assignmentId: string,
  latitude: number | null,
  longitude: number | null
): Promise<{ success: boolean; message: string; record?: AttendanceRecord }> {
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
  await db
    .update(shiftAssignments)
    .set({ status: 'confirmed', confirmedAt: now })
    .where(and(
      eq(shiftAssignments.id, assignmentId),
      eq(shiftAssignments.status, 'assigned')
    ));

  return { success: true, message: 'Inchecken succesvol', record };
}

export async function checkOutCore(
  assignmentId: string,
  latitude: number | null,
  longitude: number | null
): Promise<{ success: boolean; message: string; record?: AttendanceRecord }> {
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