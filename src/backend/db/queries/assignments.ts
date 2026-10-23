import 'server-only';
import { db } from '..';
import { shiftAssignments, shifts, profiles, attendanceRecords } from '../schema';
import { eq, and, desc, count, gte, lte, asc } from 'drizzle-orm';
import type { ShiftAssignment } from '../schema';
import { logAuditEvent, type AuditMetadata } from './audit';

/**
 * Get shift assignments with filtering
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
  status?: string;
  page?: number;
  limit?: number;
}): Promise<{ data: ShiftAssignment[]; total: number }> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (shiftId) {
    conditions.push(eq(shiftAssignments.shiftId, shiftId));
  }

  if (employeeId) {
    conditions.push(eq(shiftAssignments.employeeId, employeeId));
  }

  if (status) {
    conditions.push(eq(shiftAssignments.status, status as any));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(shiftAssignments)
    .where(whereClause);

  const data = await db
    .select()
    .from(shiftAssignments)
    .where(whereClause)
    .orderBy(desc(shiftAssignments.assignedAt))
    .limit(limit)
    .offset(offset);

  return { data, total };
}

/**
 * Get shift assignments with details
 */
export async function getAssignmentsWithDetails({
  shiftId,
  employeeId,
  page = 1,
  limit = 20,
}: {
  shiftId?: string;
  employeeId?: string;
  page?: number;
  limit?: number;
}): Promise<{
  data: (ShiftAssignment & {
    shift: { title: string; startAt: Date; endAt: Date; location: string };
    employee: { fullName: string; email: string; phone: string | null };
  })[];
  total: number;
}> {
  const offset = (page - 1) * limit;

  const conditions = [];

  if (shiftId) {
    conditions.push(eq(shiftAssignments.shiftId, shiftId));
  }

  if (employeeId) {
    conditions.push(eq(shiftAssignments.employeeId, employeeId));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [{ total }] = await db
    .select({ total: count() })
    .from(shiftAssignments)
    .where(whereClause);

  const data = await db
    .select({
      shiftAssignment: shiftAssignments,
      shift: {
        title: shifts.title,
        startAt: shifts.startAt,
        endAt: shifts.endAt,
        location: shifts.location,
      },
      employee: {
        fullName: profiles.fullName,
        email: profiles.email,
        phone: profiles.phone,
      },
    })
    .from(shiftAssignments)
    .leftJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
    .leftJoin(profiles, eq(shiftAssignments.employeeId, profiles.id))
    .where(whereClause)
    .orderBy(desc(shiftAssignments.assignedAt))
    .limit(limit)
    .offset(offset);

  return {
    data: data.map((item) => ({
      ...item.shiftAssignment,
      shift: item.shift!,
      employee: item.employee!,
    })),
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