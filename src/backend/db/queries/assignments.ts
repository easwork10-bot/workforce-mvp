import 'server-only';
import { db } from '..';
import { shiftAssignments, shifts, attendanceRecords, profiles } from '../schema';
import { eq, and, desc, count, gte, lte, asc, inArray } from 'drizzle-orm';
import type { Profile, Shift, ShiftAssignment } from '../schema';
import { logAuditEvent, type AuditMetadata } from './audit';
import { createNotificationIdempotent } from './notifications';

export type CancelAssignmentResult =
  | { success: true; code: 'ASSIGNMENT_CANCELLED'; replayed: boolean }
  | {
      success: false;
      code: 'ASSIGNMENT_NOT_FOUND' | 'ASSIGNMENT_STATE_CONFLICT' | 'SHIFT_STARTED'
        | 'ATTENDANCE_EXISTS' | 'INTERNAL_ERROR';
      message: string;
    };

export async function cancelAssignment(
  assignmentId: string,
  actorId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<CancelAssignmentResult> {
  try {
    return await db.transaction<CancelAssignmentResult>(async (tx) => {
      const [reference] = await tx.select({ shiftId: shiftAssignments.shiftId })
        .from(shiftAssignments).where(eq(shiftAssignments.id, assignmentId)).limit(1);
      if (!reference) {
        return { success: false, code: 'ASSIGNMENT_NOT_FOUND', message: 'Indeling niet gevonden' };
      }
      const [shift] = await tx.select().from(shifts)
        .where(eq(shifts.id, reference.shiftId)).for('update').limit(1);
      const [assignment] = await tx.select().from(shiftAssignments)
        .where(eq(shiftAssignments.id, assignmentId)).for('update').limit(1);
      if (!shift || !assignment) {
        return { success: false, code: 'ASSIGNMENT_NOT_FOUND', message: 'Indeling niet gevonden' };
      }
      if (assignment.shiftId !== shift.id) {
        return { success: false, code: 'ASSIGNMENT_STATE_CONFLICT', message: 'Indeling is gewijzigd' };
      }
      if (assignment.status === 'cancelled') {
        return { success: true, code: 'ASSIGNMENT_CANCELLED', replayed: true };
      }
      if (!['assigned', 'confirmed'].includes(assignment.status)) {
        return { success: false, code: 'ASSIGNMENT_STATE_CONFLICT', message: 'Alleen actieve indelingen kunnen worden geannuleerd' };
      }
      // Check the current time after acquiring locks, including time spent waiting.
      if (shift.startAt.getTime() <= Date.now()) {
        return { success: false, code: 'SHIFT_STARTED', message: 'De dienst is al begonnen' };
      }
      const attendance = await tx.select().from(attendanceRecords)
        .where(eq(attendanceRecords.shiftAssignmentId, assignment.id)).for('update');
      if (attendance.some(record => record.checkInAt !== null || record.checkOutAt !== null
        || ['checked_in', 'checked_out', 'late', 'missed_checkout'].includes(record.attendanceStatus))) {
        return { success: false, code: 'ATTENDANCE_EXISTS', message: 'Medewerker heeft al ingecheckt' };
      }

      await tx.update(shiftAssignments).set({ status: 'cancelled' }).where(eq(shiftAssignments.id, assignment.id));
      const [{ occupied }] = await tx.select({ occupied: count() }).from(shiftAssignments).where(and(
        eq(shiftAssignments.shiftId, shift.id), inArray(shiftAssignments.status, ['assigned', 'confirmed'])
      ));
      if (shift.status === 'filled' && occupied < shift.requiredWorkers) {
        await tx.update(shifts).set({ status: 'open', updatedAt: new Date() }).where(eq(shifts.id, shift.id));
        await logAuditEvent({
          actorId, action: 'UPDATE', entityType: 'shifts', entityId: shift.id,
          oldValues: { status: 'filled' }, newValues: { status: 'open' }, ...auditMetadata,
        }, tx);
      }
      await logAuditEvent({
        actorId, action: 'UPDATE', entityType: 'shift_assignments', entityId: assignment.id,
        oldValues: { status: assignment.status }, newValues: { status: 'cancelled' }, ...auditMetadata,
      }, tx);
      const [employee] = await tx.select({ language: profiles.preferredLanguage }).from(profiles)
        .where(eq(profiles.id, assignment.employeeId)).limit(1);
      const language = employee?.language ?? 'nl';
      const text = {
        nl: { title: 'Indeling geannuleerd', message: `Je indeling voor de dienst "${shift.title}" is geannuleerd.` },
        ar: { title: 'تم إلغاء التكليف', message: `تم إلغاء تكليفك بالمناوبة "${shift.title}".` },
        en: { title: 'Assignment cancelled', message: `Your assignment for shift "${shift.title}" has been cancelled.` },
      }[language];
      const notice = await createNotificationIdempotent({
        recipientId: assignment.employeeId, type: 'shift_updated', ...text,
        relatedShiftId: shift.id, relatedApplicationId: assignment.applicationId,
        idempotencyKey: `assignment-cancellation:v1:${assignment.id}`,
      }, tx);
      if (!notice.replayed) {
        await logAuditEvent({
          actorId, action: 'INSERT', entityType: 'notifications', entityId: notice.notification.id,
          oldValues: null, newValues: { type: 'shift_updated', assignmentId: assignment.id, read: false },
          ...auditMetadata,
        }, tx);
      }
      return { success: true, code: 'ASSIGNMENT_CANCELLED', replayed: false };
    });
  } catch (error) {
    console.error('[cancelAssignment] Transaction failed:', error);
    return { success: false, code: 'INTERNAL_ERROR', message: 'Annuleren van indeling mislukt' };
  }
}

export type AssignmentListItem = ShiftAssignment & {
  employee: Pick<Profile, 'id' | 'fullName'>;
  shift: Pick<Shift, 'id' | 'title' | 'location' | 'startAt' | 'endAt'>;
};

/**
 * Get shift assignments with filtering and employee/shift display information
 */
export async function getAssignments({
  shiftId,
  employeeId,
  status,
  page = 1,
  limit = 20,
}: {
  shiftId?: string;
  employeeId?: string;
  status?: ShiftAssignment['status'];
  page?: number;
  limit?: number;
}): Promise<{ data: AssignmentListItem[]; total: number }> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (shiftId) {
    conditions.push(eq(shiftAssignments.shiftId, shiftId));
  }

  if (employeeId) {
    conditions.push(eq(shiftAssignments.employeeId, employeeId));
  }

  if (status) {
    conditions.push(eq(shiftAssignments.status, status));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(shiftAssignments)
    .where(whereClause);

  const data = await db
    .select({
      assignment: shiftAssignments,
      employee: { id: profiles.id, fullName: profiles.fullName },
      shift: {
        id: shifts.id,
        title: shifts.title,
        location: shifts.location,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
      },
    })
    .from(shiftAssignments)
    .innerJoin(profiles, eq(shiftAssignments.employeeId, profiles.id))
    .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
    .where(whereClause)
    .orderBy(desc(shiftAssignments.assignedAt), desc(shiftAssignments.id))
    .limit(limit)
    .offset(offset);

  return {
    data: data.map(({ assignment, employee, shift }) => ({ ...assignment, employee, shift })),
    total,
  };
}

/**
 * Confirm a shift assignment (employee checks in)
 */
export async function confirmAssignment(
  assignmentId: string,
  confirmedBy: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [assignment] = await tx
      .select()
      .from(shiftAssignments)
      .where(eq(shiftAssignments.id, assignmentId))
      .for('update')
      .limit(1);

    if (!assignment) return false;
    if (assignment.status === 'confirmed') return true;
    if (assignment.status !== 'assigned') return false;

    await tx
      .update(shiftAssignments)
      .set({
        status: 'confirmed',
        confirmedAt: new Date(),
      })
      .where(eq(shiftAssignments.id, assignmentId));

    await logAuditEvent({
      actorId: confirmedBy,
      action: 'UPDATE',
      entityType: 'shift_assignments',
      entityId: assignment.id,
      oldValues: { status: assignment.status },
      newValues: { status: 'confirmed' },
      ...auditMetadata,
    }, tx);
    return true;
  });
}

/**
 * Get employee schedule (upcoming and past assignments with attendance)
 */
export async function getEmployeeSchedule({
  employeeId,
  startFrom,
  startTo,
  status,
  page = 1,
  limit = 20,
}: {
  employeeId: string;
  startFrom?: string;
  startTo?: string;
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{
  data: (ShiftAssignment & {
    shift: {
      id: string;
      title: string;
      workType: string;
      location: string;
      latitude: string | null;
      longitude: string | null;
      startAt: Date;
      endAt: Date;
      compensationType: string;
      compensationAmount: string | null;
      status: string;
    };
    attendance: {
      id: string;
      checkInAt: Date | null;
      checkOutAt: Date | null;
      attendanceStatus: string;
    } | null;
  })[];
  total: number;
}> {
  const offset = (page - 1) * limit;

  const conditions = [eq(shiftAssignments.employeeId, employeeId)];

  if (status) {
    conditions.push(eq(shiftAssignments.status, status as any));
  }

  if (startFrom) {
    conditions.push(gte(shifts.startAt, new Date(startFrom)));
  }

  if (startTo) {
    conditions.push(lte(shifts.startAt, new Date(startTo)));
  }

  const whereClause = and(...conditions);

  // Total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(shiftAssignments)
    .leftJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
    .where(whereClause);

  // Fetch data
  const data = await db
    .select({
      assignment: shiftAssignments,
      shift: {
        id: shifts.id,
        title: shifts.title,
        workType: shifts.workType,
        location: shifts.location,
        latitude: shifts.latitude,
        longitude: shifts.longitude,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
        compensationType: shifts.compensationType,
        compensationAmount: shifts.compensationAmount,
        status: shifts.status,
      },
    })
    .from(shiftAssignments)
    .leftJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
    .where(whereClause)
    .orderBy(asc(shifts.startAt))
    .limit(limit)
    .offset(offset);

  // For each assignment, get the most recent attendance record
  const result = await Promise.all(
    data.map(async (item) => {
      const [attendance] = await db
        .select({
          id: attendanceRecords.id,
          checkInAt: attendanceRecords.checkInAt,
          checkOutAt: attendanceRecords.checkOutAt,
          attendanceStatus: attendanceRecords.attendanceStatus,
        })
        .from(attendanceRecords)
        .where(eq(attendanceRecords.shiftAssignmentId, item.assignment.id))
        .orderBy(desc(attendanceRecords.createdAt))
        .limit(1);

      return {
        ...item.assignment,
        shift: item.shift!,
        attendance: attendance || null,
      };
    })
  );

  return { data: result, total };
}