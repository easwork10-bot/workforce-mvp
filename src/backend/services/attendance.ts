import 'server-only';

import { db } from '@/backend/db';
import { attendanceRecords, shiftAssignments } from '@/backend/db/schema';
import { eq, and, desc, or } from 'drizzle-orm';
import type { AttendanceRecord } from '@/backend/db/schema';
import { logAuditEvent, type AuditMetadata } from '@/backend/db/queries/audit';

type AttendanceExecutor = Pick<typeof db, 'transaction'>;

/**
 * Core attendance service - shared logic for check-in/out operations
 * Does NOT include authorization/ownership checks - those are handled by route layers
 */
export async function checkInCore(
  assignmentId: string,
  latitude: number | null,
  longitude: number | null,
  actorId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null },
  executor: AttendanceExecutor = db
): Promise<{ success: boolean; message: string; record?: AttendanceRecord }> {
  return executor.transaction(async (tx) => {
    const [assignment] = await tx
      .select({
        id: shiftAssignments.id,
        status: shiftAssignments.status,
      })
      .from(shiftAssignments)
      .where(eq(shiftAssignments.id, assignmentId))
      .for('update')
      .limit(1);

    if (!assignment || !['assigned', 'confirmed'].includes(assignment.status)) {
      return { success: false, message: 'Kan niet inchecken voor deze dienst' };
    }

    const existing = await tx
      .select()
      .from(attendanceRecords)
      .where(
        and(
          eq(attendanceRecords.shiftAssignmentId, assignmentId),
          eq(attendanceRecords.attendanceStatus, 'checked_in')
        )
      )
      .for('update')
      .limit(1);

    if (existing.length > 0) {
      return { success: false, message: 'Al ingecheckt voor deze dienst' };
    }

    const now = new Date();
    const [record] = await tx
      .insert(attendanceRecords)
      .values({
        shiftAssignmentId: assignmentId,
        checkInAt: now,
        checkInLatitude: latitude != null ? latitude.toString() : null,
        checkInLongitude: longitude != null ? longitude.toString() : null,
        attendanceStatus: 'checked_in',
      })
      .returning();

    const [confirmedAssignment] = await tx
      .update(shiftAssignments)
      .set({ status: 'confirmed', confirmedAt: now })
      .where(and(
        eq(shiftAssignments.id, assignmentId),
        eq(shiftAssignments.status, 'assigned')
      ))
      .returning();

    await logAuditEvent({
      actorId,
      action: 'INSERT',
      entityType: 'attendance_records',
      entityId: record.id,
      oldValues: null,
      newValues: { assignmentId, attendanceStatus: 'checked_in' },
      ...auditMetadata,
    }, tx);

    if (confirmedAssignment) {
      await logAuditEvent({
        actorId,
        action: 'UPDATE',
        entityType: 'shift_assignments',
        entityId: confirmedAssignment.id,
        oldValues: { status: 'assigned' },
        newValues: { status: 'confirmed' },
        ...auditMetadata,
      }, tx);
    }

    return { success: true, message: 'Inchecken succesvol', record };
  });
}

export async function checkOutCore(
  assignmentId: string,
  latitude: number | null,
  longitude: number | null,
  actorId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<{ success: boolean; message: string; record?: AttendanceRecord }> {
  return db.transaction(async (tx) => {
    const [record] = await tx
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
      .for('update')
      .limit(1);

    if (!record) {
      return { success: false, message: 'Geen actieve inchecken gevonden voor deze dienst' };
    }

    const now = new Date();
    const [updated] = await tx
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

    await logAuditEvent({
      actorId,
      action: 'UPDATE',
      entityType: 'attendance_records',
      entityId: updated.id,
      oldValues: { attendanceStatus: record.attendanceStatus },
      newValues: { attendanceStatus: 'checked_out' },
      ...auditMetadata,
    }, tx);

    return { success: true, message: 'Uitchecken succesvol', record: updated };
  });
}