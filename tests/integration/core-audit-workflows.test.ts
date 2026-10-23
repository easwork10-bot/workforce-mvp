import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { db, pool } from '@/backend/db';
import * as schema from '@/backend/db/schema';
import {
  attendanceRecords,
  auditLogs,
  employeeDetails,
  notifications,
  profiles,
  shiftApplications,
  shiftAssignments,
  shifts,
} from '@/backend/db/schema';
import { getAuditLogs } from '@/backend/db/queries/audit';
import { updateEmployee } from '@/backend/db/queries/employees';
import { markNotificationReadForRecipient, deleteNotificationForRecipient } from '@/backend/db/queries/notifications';
import { createShift, deleteShift } from '@/backend/db/queries/shifts';
import { checkInCore, checkOutCore } from '@/backend/services/attendance';

describe('Core workflow audit integration', () => {
  let adminId: string;
  let employeeId: string;
  const fixtureShiftIds: string[] = [];
  const fixtureApplicationIds: string[] = [];
  const fixtureAssignmentIds: string[] = [];
  const fixtureAttendanceIds: string[] = [];
  const fixtureNotificationIds: string[] = [];

  beforeEach(async () => {
    const [admin] = await db.insert(profiles).values({
      fullName: 'Core audit administrator',
      email: `core-audit-admin-${crypto.randomUUID()}@workforce.test`,
      role: 'administrator',
    }).returning();
    const [employee] = await db.insert(profiles).values({
      fullName: 'Core audit employee',
      email: `core-audit-employee-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    adminId = admin.id;
    employeeId = employee.id;
  });

  afterEach(async () => {
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, [adminId, employeeId]));
    if (fixtureNotificationIds.length) {
      await db.delete(notifications).where(inArray(notifications.id, fixtureNotificationIds));
    }
    if (fixtureAttendanceIds.length) {
      await db.delete(attendanceRecords).where(inArray(attendanceRecords.id, fixtureAttendanceIds));
    }
    if (fixtureAssignmentIds.length) {
      await db.delete(shiftAssignments).where(inArray(shiftAssignments.id, fixtureAssignmentIds));
    }
    if (fixtureApplicationIds.length) {
      await db.delete(shiftApplications).where(inArray(shiftApplications.id, fixtureApplicationIds));
    }
    if (fixtureShiftIds.length) {
      await db.delete(shifts).where(inArray(shifts.id, fixtureShiftIds));
    }
    await db.delete(employeeDetails).where(eq(employeeDetails.profileId, employeeId));
    await db.delete(profiles).where(inArray(profiles.id, [adminId, employeeId]));
    fixtureShiftIds.length = 0;
    fixtureApplicationIds.length = 0;
    fixtureAssignmentIds.length = 0;
    fixtureAttendanceIds.length = 0;
    fixtureNotificationIds.length = 0;
  });

  it('audits shift creation without copying sensitive business fields', async () => {
    const shift = await createShift({
      title: 'Audit-safe shift title',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 1,
      compensationType: 'hourly',
      compensationAmount: '42.00',
      description: 'Do not copy this description',
      instructions: 'Do not copy these instructions',
      createdBy: adminId,
      status: 'draft',
    });
    fixtureShiftIds.push(shift.id);

    const { data, total } = await getAuditLogs({
      actorId: adminId,
      entityType: 'shifts',
      entityId: shift.id,
    });
    expect(total).toBe(1);
    expect(data[0].newValues).toEqual({ status: 'draft' });
    expect(JSON.stringify(data[0])).not.toContain('Do not copy');
  });

  it('audits all related records when deleting a shift', async () => {
    const shift = await createShift({
      title: 'Shift deletion audit',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: adminId,
      status: 'open',
    });
    fixtureShiftIds.push(shift.id);
    const [application] = await db.insert(shiftApplications).values({
      shiftId: shift.id,
      employeeId,
      status: 'accepted',
    }).returning();
    fixtureApplicationIds.push(application.id);
    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: shift.id,
      employeeId,
      applicationId: application.id,
      status: 'assigned',
      assignedBy: adminId,
    }).returning();
    fixtureAssignmentIds.push(assignment.id);
    const [attendance] = await db.insert(attendanceRecords).values({
      shiftAssignmentId: assignment.id,
      attendanceStatus: 'checked_in',
      checkInAt: new Date(),
    }).returning();
    fixtureAttendanceIds.push(attendance.id);
    const [notification] = await db.insert(notifications).values({
      recipientId: employeeId,
      type: 'shift_created',
      title: 'Shift deletion audit',
      relatedShiftId: shift.id,
      relatedApplicationId: application.id,
    }).returning();
    fixtureNotificationIds.push(notification.id);

    expect(await deleteShift(shift.id, adminId)).toBe(true);
    const logs = await getAuditLogs({ actorId: adminId, page: 1, limit: 20 });
    const [updatedNotification] = await db.select().from(notifications).where(eq(notifications.id, notification.id));

    expect(logs.data.map((entry) => `${entry.action}:${entry.entityType}`).sort()).toEqual([
      'DELETE:attendance_records',
      'DELETE:shift_applications',
      'DELETE:shift_assignments',
      'DELETE:shifts',
      'INSERT:shifts',
      'UPDATE:notifications',
    ]);
    expect(updatedNotification.relatedShiftId).toBeNull();
    expect(updatedNotification.relatedApplicationId).toBeNull();
  });

  it('audits employee profile, role, and detail changes without storing personal values', async () => {
    const updated = await updateEmployee(
      employeeId,
      adminId,
      { fullName: 'Updated audit employee', accountStatus: 'inactive' },
      'supervisor',
      {
        bankAccountIban: 'NL00SECRET123',
        emergencyContactPhone: '+31000000000',
      }
    );
    const logs = await getAuditLogs({ actorId: adminId, page: 1, limit: 10 });

    expect(updated).toBe(true);
    expect(logs.total).toBe(3);
    expect(logs.data.map((entry) => entry.entityType).sort()).toEqual([
      'employee_details',
      'profiles',
      'user_roles',
    ]);
    expect(logs.data.find((entry) => entry.entityType === 'profiles')?.newValues).toEqual({
      changedFields: ['accountStatus', 'fullName'],
      accountStatus: 'inactive',
    });
    expect(logs.data.find((entry) => entry.entityType === 'employee_details')?.newValues).toEqual({
      changedFields: ['bankAccountIban', 'emergencyContactPhone'],
    });
    expect(JSON.stringify(logs.data)).not.toContain('NL00SECRET123');
    expect(JSON.stringify(logs.data)).not.toContain('+31000000000');
  });

  it('audits check-in and check-out plus the associated assignment transition', async () => {
    const shift = await db.insert(shifts).values({
      title: 'Attendance audit shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: adminId,
      status: 'open',
    }).returning();
    fixtureShiftIds.push(shift[0].id);
    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: shift[0].id,
      employeeId,
      status: 'assigned',
      assignedBy: adminId,
    }).returning();
    fixtureAssignmentIds.push(assignment.id);

    const checkIn = await checkInCore(assignment.id, 52.1, 4.3, employeeId);
    const checkOut = await checkOutCore(assignment.id, 52.1, 4.3, employeeId);
    const logs = await getAuditLogs({ actorId: employeeId, page: 1, limit: 10 });

    expect(checkIn.success).toBe(true);
    expect(checkOut.success).toBe(true);
    expect(logs.total).toBe(3);
    expect(logs.data.map((entry) => `${entry.entityType}:${entry.action}`).sort()).toEqual([
      'attendance_records:INSERT',
      'attendance_records:UPDATE',
      'shift_assignments:UPDATE',
    ]);
    expect(JSON.stringify(logs.data)).not.toContain('52.1');
    expect(JSON.stringify(logs.data)).not.toContain('4.3');
  });

  it('allows only one concurrent initial check-in for the same assignment', async () => {
    const [shift] = await db.insert(shifts).values({
      title: 'Concurrent attendance check-in',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 1,
      createdBy: adminId,
      status: 'open',
    }).returning();
    fixtureShiftIds.push(shift.id);

    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: shift.id,
      employeeId,
      status: 'assigned',
      assignedBy: adminId,
    }).returning();
    fixtureAssignmentIds.push(assignment.id);

    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const backendPids = await Promise.all(clients.map(async (client) => {
        const result = await client.query('SELECT pg_backend_pid() AS pid');
        return result.rows[0].pid as number;
      }));
      expect(new Set(backendPids).size).toBe(2);

      const executors = clients.map((client) => drizzle(client, { schema }));
      const results = await Promise.all(executors.map((executor) =>
        checkInCore(assignment.id, 52.1, 4.3, employeeId, undefined, executor)
      ));

      expect(results.filter((result) => result.success)).toHaveLength(1);
      expect(results.filter((result) => !result.success)).toHaveLength(1);
      expect(results.find((result) => !result.success)?.message).toContain('Al ingecheckt');

      const records = await db.select().from(attendanceRecords).where(and(
        eq(attendanceRecords.shiftAssignmentId, assignment.id),
        eq(attendanceRecords.attendanceStatus, 'checked_in')
      ));
      fixtureAttendanceIds.push(...records.map((record) => record.id));
      expect(records).toHaveLength(1);

      const attendanceAudit = await db.select().from(auditLogs).where(and(
        eq(auditLogs.actorId, employeeId),
        eq(auditLogs.entityType, 'attendance_records'),
        eq(auditLogs.entityId, records[0].id)
      ));
      expect(attendanceAudit).toHaveLength(1);
      expect(attendanceAudit[0].action).toBe('INSERT');

      const assignmentAudit = await db.select().from(auditLogs).where(and(
        eq(auditLogs.actorId, employeeId),
        eq(auditLogs.entityType, 'shift_assignments'),
        eq(auditLogs.entityId, assignment.id)
      ));
      expect(assignmentAudit).toHaveLength(1);
      expect(assignmentAudit[0].action).toBe('UPDATE');
    } finally {
      clients.forEach((client) => client.release());
    }
  });

  it('checks in different assignments concurrently without serializing them against each other', async () => {
    const assignmentIds: string[] = [];
    for (const title of ['Concurrent independent shift A', 'Concurrent independent shift B']) {
      const [shift] = await db.insert(shifts).values({
        title,
        workType: 'cleaning',
        location: 'Amsterdam',
        startAt: new Date('2099-01-02T09:00:00Z'),
        endAt: new Date('2099-01-02T17:00:00Z'),
        requiredWorkers: 1,
        createdBy: adminId,
        status: 'open',
      }).returning();
      fixtureShiftIds.push(shift.id);

      const [assignment] = await db.insert(shiftAssignments).values({
        shiftId: shift.id,
        employeeId,
        status: 'assigned',
        assignedBy: adminId,
      }).returning();
      fixtureAssignmentIds.push(assignment.id);
      assignmentIds.push(assignment.id);
    }

    const clients = await Promise.all([pool.connect(), pool.connect()]);
    try {
      const backendPids = await Promise.all(clients.map(async (client) => {
        const result = await client.query('SELECT pg_backend_pid() AS pid');
        return result.rows[0].pid as number;
      }));
      expect(new Set(backendPids).size).toBe(2);

      const executors = clients.map((client) => drizzle(client, { schema }));
      const results = await Promise.all(assignmentIds.map((assignmentId, index) =>
        checkInCore(assignmentId, 52.1, 4.3, employeeId, undefined, executors[index])
      ));

      expect(results.every((result) => result.success)).toBe(true);

      const records = await db.select().from(attendanceRecords).where(and(
        inArray(attendanceRecords.shiftAssignmentId, assignmentIds),
        eq(attendanceRecords.attendanceStatus, 'checked_in')
      ));
      fixtureAttendanceIds.push(...records.map((record) => record.id));
      expect(records).toHaveLength(2);
      expect(new Set(records.map((record) => record.shiftAssignmentId)).size).toBe(2);

      const attendanceAudits = await db.select().from(auditLogs).where(and(
        eq(auditLogs.actorId, employeeId),
        eq(auditLogs.entityType, 'attendance_records'),
        inArray(auditLogs.entityId, records.map((record) => record.id))
      ));
      expect(attendanceAudits).toHaveLength(2);
    } finally {
      clients.forEach((client) => client.release());
    }
  });

  it('audits notification read and dismissal once, scoped to its owner', async () => {
    const [notification] = await db.insert(notifications).values({
      recipientId: employeeId,
      type: 'shift_created',
      title: 'Audit notification',
    }).returning();
    fixtureNotificationIds.push(notification.id);

    expect(await markNotificationReadForRecipient(notification.id, employeeId)).toBe(true);
    expect(await markNotificationReadForRecipient(notification.id, employeeId)).toBe(true);
    expect(await deleteNotificationForRecipient(notification.id, employeeId)).toBe(true);
    const logs = await getAuditLogs({
      actorId: employeeId,
      entityType: 'notifications',
      entityId: notification.id,
    });

    expect(logs.total).toBe(2);
    expect(logs.data.map((entry) => entry.action).sort()).toEqual(['DELETE', 'UPDATE']);
    expect(await deleteNotificationForRecipient(notification.id, adminId)).toBe(false);
  });
});
