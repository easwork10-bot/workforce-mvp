import { db } from '..';
import {
  attendanceRecords,
  notifications,
  shifts,
  profiles,
  shiftApplications,
  shiftAssignments,
} from '../schema';
import { eq, and, desc, asc, gte, lte, ilike, count, notInArray, inArray, or } from 'drizzle-orm';
import type { Shift, NewShift } from '../schema';
import { logAuditEvent, type AuditMetadata } from './audit';

/**
 * Get shifts with pagination, filtering, and sorting
 */
export async function getShifts({
  status,
  workType,
  startFrom,
  startTo,
  page = 1,
  limit = 20,
  sortOrder = 'asc',
}: {
  status?: string;
  workType?: string;
  startFrom?: string;
  startTo?: string;
  page?: number;
  limit?: number;
  sortOrder?: 'asc' | 'desc';
}): Promise<{ data: (Shift & { applicationCount: number; assignedCount: number })[]; total: number }> {
  const offset = (page - 1) * limit;

  // Build where conditions
  const conditions = [];

  if (status) {
    conditions.push(eq(shifts.status, status as any));
  }

  if (workType) {
    conditions.push(ilike(shifts.workType, `%${workType}%`));
  }

  if (startFrom) {
    conditions.push(gte(shifts.startAt, new Date(startFrom)));
  }

  if (startTo) {
    conditions.push(lte(shifts.startAt, new Date(startTo)));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(shifts)
    .where(whereClause);

  // Get raw shifts
  const shiftList = await db
    .select()
    .from(shifts)
    .where(whereClause)
    .orderBy(sortOrder === 'desc' ? desc(shifts.startAt) : asc(shifts.startAt))
    .limit(limit)
    .offset(offset);

  // Get application and assignment counts for each shift
  const data = await Promise.all(
    shiftList.map(async (shift) => {
      const [{ applicationCount }] = await db
        .select({ applicationCount: count() })
        .from(shiftApplications)
        .where(eq(shiftApplications.shiftId, shift.id));

      const [{ assignedCount }] = await db
        .select({ assignedCount: count() })
        .from(shiftAssignments)
        .where(eq(shiftAssignments.shiftId, shift.id));

      return {
        ...shift,
        applicationCount,
        assignedCount,
      };
    })
  );

  return { data, total };
}

interface ShiftWithDetails extends Shift {
  creator: { fullName: string; email: string } | null;
  applications: { id: string; employeeId: string; status: string; appliedAt: Date }[];
  assignments: { id: string; employeeId: string; status: string }[];
}

/**
 * Get a single shift by ID with full details
 */
export async function getShiftById(id: string): Promise<ShiftWithDetails | null> {
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, id))
    .limit(1);

  if (!shift) return null;

  let creator = null;
  if (shift.createdBy) {
    const [c] = await db
      .select({ fullName: profiles.fullName, email: profiles.email })
      .from(profiles)
      .where(eq(profiles.id, shift.createdBy))
      .limit(1);
    creator = c || null;
  }

  const applications = await db
    .select({
      id: shiftApplications.id,
      employeeId: shiftApplications.employeeId,
      status: shiftApplications.status,
      appliedAt: shiftApplications.appliedAt,
    })
    .from(shiftApplications)
    .where(eq(shiftApplications.shiftId, id));

  const assignments = await db
    .select({
      id: shiftAssignments.id,
      employeeId: shiftAssignments.employeeId,
      status: shiftAssignments.status,
    })
    .from(shiftAssignments)
    .where(eq(shiftAssignments.shiftId, id));

  return {
    ...shift,
    creator,
    applications,
    assignments,
  };
}

/**
 * Create a new shift
 */
export async function createShift(
  data: NewShift,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<Shift> {
  return db.transaction(async (tx) => {
    const [shift] = await tx.insert(shifts).values(data).returning();
    await logAuditEvent({
      actorId: data.createdBy,
      action: 'INSERT',
      entityType: 'shifts',
      entityId: shift.id,
      oldValues: null,
      newValues: { status: shift.status },
      ...auditMetadata,
    }, tx);
    return shift;
  });
}

/**
 * Update a shift
 */
export async function updateShift(
  id: string,
  actorId: string,
  data: Partial<NewShift>,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<Shift | null> {
  return db.transaction(async (tx) => {
    const [previous] = await tx
      .select()
      .from(shifts)
      .where(eq(shifts.id, id))
      .for('update')
      .limit(1);
    if (!previous) return null;

    const [shift] = await tx
      .update(shifts)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(shifts.id, id))
      .returning();

    const changedFields = Object.keys(data).sort();
    if (changedFields.length > 0) {
      await logAuditEvent({
        actorId,
        action: 'UPDATE',
        entityType: 'shifts',
        entityId: id,
        oldValues: {
          changedFields,
          ...(changedFields.includes('status') ? { status: previous.status } : {}),
        },
        newValues: {
          changedFields,
          ...(changedFields.includes('status') && data.status ? { status: data.status } : {}),
        },
        ...auditMetadata,
      }, tx);
    }
    return shift || null;
  });
}

/**
 * Delete a shift
 */
export async function deleteShift(
  id: string,
  actorId: string,
  auditMetadata: AuditMetadata = { ipAddress: null, userAgent: null }
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(shifts)
      .where(eq(shifts.id, id))
      .for('update')
      .limit(1);
    if (!shift) return false;

    const applications = await tx
      .select({ id: shiftApplications.id, status: shiftApplications.status })
      .from(shiftApplications)
      .where(eq(shiftApplications.shiftId, id));
    const assignments = await tx
      .select({
        id: shiftAssignments.id,
        status: shiftAssignments.status,
        applicationId: shiftAssignments.applicationId,
      })
      .from(shiftAssignments)
      .where(eq(shiftAssignments.shiftId, id));
    const assignmentIds = assignments.map((assignment) => assignment.id);
    const applicationIds = applications.map((application) => application.id);
    const attendance = assignmentIds.length
      ? await tx
          .select({
            id: attendanceRecords.id,
            attendanceStatus: attendanceRecords.attendanceStatus,
          })
          .from(attendanceRecords)
          .where(inArray(attendanceRecords.shiftAssignmentId, assignmentIds))
      : [];

    const notificationConditions = [eq(notifications.relatedShiftId, id)];
    if (applicationIds.length) {
      notificationConditions.push(inArray(notifications.relatedApplicationId, applicationIds));
    }
    const relatedNotifications = await tx
      .select({
        id: notifications.id,
        relatedShiftId: notifications.relatedShiftId,
        relatedApplicationId: notifications.relatedApplicationId,
      })
      .from(notifications)
      .where(or(...notificationConditions));

    if (attendance.length) {
      await tx.delete(attendanceRecords).where(inArray(
        attendanceRecords.id,
        attendance.map((record) => record.id)
      ));
      for (const record of attendance) {
        await logAuditEvent({
          actorId,
          action: 'DELETE',
          entityType: 'attendance_records',
          entityId: record.id,
          oldValues: { attendanceStatus: record.attendanceStatus },
          newValues: null,
          ...auditMetadata,
        }, tx);
      }
    }

    if (assignments.length) {
      await tx.delete(shiftAssignments).where(inArray(
        shiftAssignments.id,
        assignmentIds
      ));
      for (const assignment of assignments) {
        await logAuditEvent({
          actorId,
          action: 'DELETE',
          entityType: 'shift_assignments',
          entityId: assignment.id,
          oldValues: {
            status: assignment.status,
            applicationId: assignment.applicationId,
          },
          newValues: null,
          ...auditMetadata,
        }, tx);
      }
    }

    if (relatedNotifications.length) {
      await tx.update(notifications)
        .set({ relatedShiftId: null, relatedApplicationId: null })
        .where(inArray(notifications.id, relatedNotifications.map((notification) => notification.id)));
      for (const notification of relatedNotifications) {
        await logAuditEvent({
          actorId,
          action: 'UPDATE',
          entityType: 'notifications',
          entityId: notification.id,
          oldValues: {
            relatedShiftId: notification.relatedShiftId,
            relatedApplicationId: notification.relatedApplicationId,
          },
          newValues: { relatedShiftId: null, relatedApplicationId: null },
          ...auditMetadata,
        }, tx);
      }
    }

    if (applications.length) {
      await tx.delete(shiftApplications).where(inArray(
        shiftApplications.id,
        applicationIds
      ));
      for (const application of applications) {
        await logAuditEvent({
          actorId,
          action: 'DELETE',
          entityType: 'shift_applications',
          entityId: application.id,
          oldValues: { status: application.status },
          newValues: null,
          ...auditMetadata,
        }, tx);
      }
    }

    await tx.delete(shifts).where(eq(shifts.id, id));
    await logAuditEvent({
      actorId,
      action: 'DELETE',
      entityType: 'shifts',
      entityId: id,
      oldValues: { status: shift.status },
      newValues: null,
      ...auditMetadata,
    }, tx);
    return true;
  });
}

/**
 * Get shift statistics for admin dashboard
 */
export async function getShiftStats(): Promise<{
  total: number;
  draft: number;
  open: number;
  filled: number;
  cancelled: number;
  completed: number;
}> {
  const stats = await db
    .select({
      status: shifts.status,
      count: count(),
    })
    .from(shifts)
    .groupBy(shifts.status);

  const result = {
    total: 0,
    draft: 0,
    open: 0,
    filled: 0,
    cancelled: 0,
    completed: 0,
  };

  for (const stat of stats) {
    result[stat.status as keyof typeof result] = stat.count;
    result.total += stat.count;
  }

  return result;
}

/**
 * Get available shifts for an employee to browse
 * Returns only open shifts that are not filled/cancelled,
 * and the employee hasn't already applied to or been assigned to
 */
export async function getAvailableShiftsForEmployee({
  employeeId,
  workType,
  startFrom,
  startTo,
  page = 1,
  limit = 20,
}: {
  employeeId: string;
  workType?: string;
  startFrom?: string;
  startTo?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: (Shift & { applicationCount: number; assignedCount: number; hasApplied: boolean })[]; total: number }> {
  const offset = (page - 1) * limit;

  // Build where conditions for shifts
  const conditions = [
    eq(shifts.status, 'open'),
  ];

  if (workType) {
    conditions.push(ilike(shifts.workType, `%${workType}%`));
  }

  if (startFrom) {
    conditions.push(gte(shifts.startAt, new Date(startFrom)));
  }

  if (startTo) {
    conditions.push(lte(shifts.startAt, new Date(startTo)));
  }

  // Exclude shifts where employee has already applied (only pending/accepted block re-application)
  const appliedShiftIds = db
    .select({ shiftId: shiftApplications.shiftId })
    .from(shiftApplications)
    .where(and(
      eq(shiftApplications.employeeId, employeeId),
      inArray(shiftApplications.status, ['pending', 'accepted'])
    ));

  // Exclude shifts where employee is already actively assigned
  const assignedShiftIds = db
    .select({ shiftId: shiftAssignments.shiftId })
    .from(shiftAssignments)
    .where(and(
      eq(shiftAssignments.employeeId, employeeId),
      inArray(shiftAssignments.status, ['assigned', 'confirmed'])
    ));

  conditions.push(notInArray(shifts.id, appliedShiftIds));
  conditions.push(notInArray(shifts.id, assignedShiftIds));

  const whereClause = and(...conditions);

  // Get total count
  const [{ total }] = await db
    .select({ total: count() })
    .from(shifts)
    .where(whereClause);

  // Get shifts with counts
  const shiftList = await db
    .select()
    .from(shifts)
    .where(whereClause)
    .orderBy(asc(shifts.startAt))
    .limit(limit)
    .offset(offset);

  const data = await Promise.all(
    shiftList.map(async (shift) => {
      const [{ applicationCount }] = await db
        .select({ applicationCount: count() })
        .from(shiftApplications)
        .where(eq(shiftApplications.shiftId, shift.id));

      const [{ assignedCount }] = await db
        .select({ assignedCount: count() })
        .from(shiftAssignments)
        .where(eq(shiftAssignments.shiftId, shift.id));

      // Check if employee has applied
      const [applied] = await db
        .select({ id: shiftApplications.id })
        .from(shiftApplications)
        .where(and(
          eq(shiftApplications.shiftId, shift.id),
          eq(shiftApplications.employeeId, employeeId)
        ))
        .limit(1);

      return {
        ...shift,
        applicationCount,
        assignedCount,
        hasApplied: !!applied,
      };
    })
  );

  return { data, total };
}

/**
 * Get shift details for employee view
 * Includes whether the employee has applied and application status
 */
export async function getShiftDetailsForEmployee(
  shiftId: string,
  employeeId: string
): Promise<(Shift & {
  applicationCount: number;
  assignedCount: number;
  hasApplied: boolean;
  applicationStatus: string | null;
  applicationId: string | null;
}) | null> {
  const [shift] = await db
    .select()
    .from(shifts)
    .where(eq(shifts.id, shiftId))
    .limit(1);

  if (!shift) return null;

  // Check if employee has access (application or assignment) before rejecting non-open shifts
  const [hasApplication] = await db
    .select({ id: shiftApplications.id })
    .from(shiftApplications)
    .where(and(
      eq(shiftApplications.shiftId, shiftId),
      eq(shiftApplications.employeeId, employeeId)
    ))
    .limit(1);

  const [hasAssignment] = await db
    .select({ id: shiftAssignments.id })
    .from(shiftAssignments)
    .where(and(
      eq(shiftAssignments.shiftId, shiftId),
      eq(shiftAssignments.employeeId, employeeId)
    ))
    .limit(1);

  if (!hasApplication && !hasAssignment && shift.status !== 'open') {
    return null;
  }

  const [{ applicationCount }] = await db
    .select({ applicationCount: count() })
    .from(shiftApplications)
    .where(eq(shiftApplications.shiftId, shiftId));

  const [{ assignedCount }] = await db
    .select({ assignedCount: count() })
    .from(shiftAssignments)
    .where(eq(shiftAssignments.shiftId, shiftId));

  const [application] = await db
    .select({
      id: shiftApplications.id,
      status: shiftApplications.status,
    })
    .from(shiftApplications)
    .where(and(
      eq(shiftApplications.shiftId, shiftId),
      eq(shiftApplications.employeeId, employeeId)
    ))
    .limit(1);

  return {
    ...shift,
    applicationCount,
    assignedCount,
    hasApplied: !!application,
    applicationStatus: application?.status || null,
    applicationId: application?.id || null,
  };
}