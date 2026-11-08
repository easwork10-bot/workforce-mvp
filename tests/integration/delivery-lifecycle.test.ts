import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { NextRequest } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { createClient } from 'redis';
import { db, pool } from '@/backend/db';
import { attendanceRecords, auditLogs, notifications, profiles, shiftApplications, shiftAssignments, shifts, userRoles } from '@/backend/db/schema';
import { createTokenPair, decodeJwt, hashToken } from '@/backend/auth/tokens';
import * as sessions from '@/backend/auth/session';
import { signCsrfToken } from '@/backend/security/csrf';
import * as audit from '@/backend/db/queries/audit';
import * as notices from '@/backend/db/queries/notifications';
import { applyForShiftWithLock, cancelPendingApplication, reviewApplication } from '@/backend/db/queries/applications';
import { cancelAssignment, confirmAssignment } from '@/backend/db/queries/assignments';
import { employeeCheckIn, upsertAttendance } from '@/backend/db/queries/attendance';
import { checkInCore } from '@/backend/services/attendance';
import { GET as listAdminShifts, POST as createShift } from '@/app/api/admin/shifts/route';
import { POST as publishShift } from '@/app/api/admin/shifts/[id]/publish/route';
import { GET as browseShifts } from '@/app/api/employee/shifts/route';
import { POST as applyShift } from '@/app/api/employee/shifts/[id]/apply/route';
import { POST as reviewShiftApplication } from '@/app/api/admin/applications/[id]/review/route';
import { POST as cancelShiftAssignment } from '@/app/api/admin/assignments/[id]/cancel/route';
import { GET as listAdminApplications } from '@/app/api/admin/applications/route';
import { adminApplicationPageSchema } from '@/shared/admin-applications';

type Identity = {
  id: string;
  token: string;
  jti: string;
  refreshHash: string;
};

describe('Delivery lifecycle with real JWT sessions, PostgreSQL and Redis', () => {
  let admin: Identity;
  let employee: Identity;
  const identities: Identity[] = [];
  const shiftIds: string[] = [];
  const csrf = signCsrfToken('delivery-lifecycle-csrf');

  beforeAll(() => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    vi.stubEnv('JWT_PRIVATE_KEY_FILE', '');
    vi.stubEnv('JWT_PUBLIC_KEY_FILE', '');
    vi.stubEnv('JWT_PRIVATE_KEY_B64', Buffer.from(keys.privateKey.export({ format: 'pem', type: 'pkcs8' })).toString('base64'));
    vi.stubEnv('JWT_PUBLIC_KEY_B64', Buffer.from(keys.publicKey.export({ format: 'pem', type: 'spki' })).toString('base64'));
  });

  beforeEach(async () => {
    try {
      admin = await identity('administrator');
      employee = await identity('employee');
    } catch (error) {
      console.error('[delivery fixture connection]', {
        total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount,
        memory: process.memoryUsage().rss,
      });
      throw error;
    }
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(auditLogs).where(inArray(auditLogs.actorId, identities.map((item) => item.id)));
    if (shiftIds.length) {
      await db.delete(notifications).where(inArray(notifications.relatedShiftId, shiftIds));
      const assignments = await db.select({ id: shiftAssignments.id }).from(shiftAssignments)
        .where(inArray(shiftAssignments.shiftId, shiftIds));
      if (assignments.length) {
        await db.delete(attendanceRecords).where(inArray(attendanceRecords.shiftAssignmentId, assignments.map(item => item.id)));
      }
      await db.delete(shifts).where(inArray(shifts.id, shiftIds));
    }
    for (const item of identities) {
      await sessions.deleteSession(item.jti, item.id, item.refreshHash);
    }
    await db.delete(profiles).where(inArray(profiles.id, identities.map((item) => item.id)));
    identities.length = 0;
    shiftIds.length = 0;
  });

  afterAll(() => vi.unstubAllEnvs());

  async function identity(role: 'administrator' | 'supervisor' | 'employee'): Promise<Identity> {
    const [profile] = await db.insert(profiles).values({
      fullName: `Delivery ${role}`,
      email: `delivery-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    await db.insert(userRoles).values({ userId: profile.id, role });
    const pair = await createTokenPair(profile.id, role, '127.0.0.1');
    const jti = decodeJwt(pair.accessToken).jti;
    if (typeof jti !== 'string') throw new Error('Generated JWT is missing its session ID');
    await sessions.createSession(jti, profile.id, role, '127.0.0.1', 'delivery-test', pair.refreshToken);
    const result = { id: profile.id, token: pair.accessToken, jti, refreshHash: hashToken(pair.refreshToken) };
    identities.push(result);
    return result;
  }

  function request(url: string, user?: Identity, body?: unknown, csrfEnabled = true): NextRequest {
    const headers = new Headers({
      cookie: `${user ? `access_token=${user.token}; ` : ''}csrf_token=${csrf}`,
      'content-type': 'application/json',
    });
    if (csrfEnabled) headers.set('x-csrf-token', csrf);
    return new NextRequest(`http://localhost${url}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }

  const input = {
    title: 'Delivery traffic control',
    workType: 'delivery-integration',
    location: 'Amsterdam',
    startAt: '2099-01-15T08:00:00.000Z',
    endAt: '2099-01-15T16:00:00.000Z',
    requiredWorkers: 2,
    status: 'open',
  };

  async function draft(): Promise<string> {
    const response = await createShift(request('/api/admin/shifts', admin, input));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.shift.status).toBe('draft');
    shiftIds.push(body.shift.id);
    return body.shift.id;
  }

  async function pending(): Promise<{ shiftId: string; applicationId: string }> {
    const shiftId = await draft();
    await publishShift(request(`/api/admin/shifts/${shiftId}/publish`, admin, {}), { params: { id: shiftId } });
    const applied = await applyForShiftWithLock(shiftId, employee.id);
    expect(applied.success).toBe(true);
    if (!applied.success) throw new Error('Expected pending application fixture');
    return { shiftId, applicationId: applied.applicationId };
  }

  it('lists every historical application attempt with validated filters, pagination and real active capacity', async () => {
    const { shiftId, applicationId } = await pending();
    const submittedAt = new Date('2026-01-01T10:00:00Z');
    await db.update(shiftApplications).set({ appliedAt: submittedAt }).where(eq(shiftApplications.id, applicationId));
    const attempts = await db.insert(shiftApplications).values(
      Array.from({ length: 23 }, (_, index) => ({
        shiftId, employeeId: employee.id,
        status: (['accepted', 'rejected', 'cancelled'] as const)[index % 3],
        appliedAt: submittedAt,
      })),
    ).returning();
    await db.insert(shiftAssignments).values({ shiftId, employeeId: employee.id, assignedBy: admin.id, status: 'confirmed' });
    await db.insert(shiftAssignments).values({ shiftId, employeeId: employee.id, assignedBy: admin.id, status: 'cancelled' });
    const list = (query: string, user?: Identity) => listAdminApplications(request(`/api/admin/applications?shiftId=${shiftId}&${query}`, user));
    expect((await list('', undefined)).status).toBe(401);
    expect((await list('', employee)).status).toBe(403);
    const supervisor = await identity('supervisor');
    expect((await list('', supervisor)).status).toBe(403);
    for (const query of ['status=invalid', 'limit=101', 'page=0', 'employeeId=invalid']) {
      expect((await list(query, admin)).status).toBe(400);
    }
    const first = adminApplicationPageSchema.parse(await (await list('page=1', admin)).json());
    const second = adminApplicationPageSchema.parse(await (await list('page=2', admin)).json());
    expect(first.pagination).toEqual({ page: 1, limit: 20, total: 24, totalPages: 2 });
    expect(first.applications).toHaveLength(20);
    expect(second.applications).toHaveLength(4);
    const all = [...first.applications, ...second.applications];
    expect(new Set(all.map(item => item.id))).toEqual(new Set([applicationId, ...attempts.map(item => item.id)]));
    expect(all.every(item => item.employee.fullName === 'Delivery employee'
      && item.shift.requiredWorkers === 2 && item.shift.assignedCount === 1 && item.shift.status === 'open')).toBe(true);
    const repeatedPage = adminApplicationPageSchema.parse(await (await list('page=1', admin)).json());
    expect(repeatedPage).toEqual(first);
    for (const status of ['pending', 'accepted', 'rejected', 'cancelled']) {
      const body = adminApplicationPageSchema.parse(await (await list(`status=${status}`, admin)).json());
      expect(body.applications.length).toBeGreaterThan(0);
      expect(body.applications.every(item => item.status === status)).toBe(true);
      expect(body.pagination.total).toBe(all.filter(item => item.status === status).length);
    }
  });

  it('refreshes list status and capacity after review and assignment cancellation', async () => {
    const { shiftId, applicationId } = await pending();
    await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, shiftId));
    const list = async () => adminApplicationPageSchema.parse(await (await listAdminApplications(
      request(`/api/admin/applications?shiftId=${shiftId}`, admin),
    )).json());
    expect((await list()).applications[0].shift.assignedCount).toBe(0);
    const approved = await reviewShiftApplication(request('/api/admin/applications/review', admin, { status: 'accepted' }), {
      params: { id: applicationId },
    });
    expect(approved.status).toBe(200);
    expect((await list()).applications[0]).toMatchObject({
      status: 'accepted', shift: { status: 'filled', assignedCount: 1, requiredWorkers: 1 },
    });
    const [assignment] = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, applicationId));
    expect(await cancelAssignment(assignment.id, admin.id)).toMatchObject({ success: true });
    expect((await list()).applications[0]).toMatchObject({ status: 'accepted', shift: { status: 'open', assignedCount: 0 } });
  });

  async function assigned() {
    const fixture = await pending();
    await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, fixture.shiftId));
    expect(await reviewApplication(fixture.applicationId, admin.id, 'accepted')).toMatchObject({ success: true });
    const [assignment] = await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, fixture.applicationId));
    return { ...fixture, assignment };
  }

  it.each(['assigned', 'confirmed'] as const)('cancels %s, reopens, preserves history and replays without side effects', async status => {
    const { shiftId, applicationId, assignment } = await assigned();
    if (status === 'confirmed') expect(await confirmAssignment(assignment.id, employee.id)).toBe(true);
    const [acceptedApplication] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, applicationId));
    const other = await identity('employee');
    const [waiting] = await db.insert(shiftApplications).values({ shiftId, employeeId: other.id }).returning();
    const cancelled = await cancelAssignment(assignment.id, admin.id);
    expect(cancelled).toEqual({ success: true, code: 'ASSIGNMENT_CANCELLED', replayed: false });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('open');
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.id, applicationId)))[0]).toEqual(acceptedApplication);
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.id, waiting.id)))[0]).toEqual(waiting);
    const [cancelledAssignment] = await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, assignment.id));
    expect(cancelledAssignment).toEqual({ ...assignment, status: 'cancelled', confirmedAt: status === 'confirmed' ? expect.any(Date) : null });
    expect(await confirmAssignment(assignment.id, employee.id)).toBe(false);
    expect((await checkInCore(assignment.id, null, null, employee.id)).success).toBe(false);
    expect((await employeeCheckIn(employee.id, assignment.id, 0, 0)).success).toBe(false);
    await expect(upsertAttendance(assignment.id, 'check_in', 0, 0, admin.id)).rejects.toThrow('inactive assignment');
    const logs = await db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id));
    const notificationsBefore = await db.select().from(notifications).where(eq(notifications.relatedShiftId, shiftId));
    const cancellationNotices = notificationsBefore.filter(item => item.idempotencyKey === `assignment-cancellation:v1:${assignment.id}`);
    expect(cancellationNotices).toHaveLength(1);
    expect(cancellationNotices[0]).toMatchObject({ recipientId: employee.id, type: 'shift_updated', title: 'Indeling geannuleerd' });
    expect(logs.filter(item => item.entityId === assignment.id && item.action === 'UPDATE')).toHaveLength(1);
    expect(logs.filter(item => item.entityId === shiftId && item.newValues?.status === 'open')).toHaveLength(2);
    const concurrentReplays = await Promise.all([1, 2].map(() => cancelAssignment(assignment.id, admin.id)));
    expect(concurrentReplays).toEqual([cancelled, cancelled].map(item => ({ ...item, replayed: true })));
    expect(await db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id))).toEqual(logs);
    expect(await db.select().from(notifications).where(eq(notifications.relatedShiftId, shiftId))).toEqual(notificationsBefore);

    const reapplied = await applyForShiftWithLock(shiftId, employee.id);
    expect(reapplied.success).toBe(true);
    if (!reapplied.success) throw new Error('Expected reapplication');
    expect(reapplied.applicationId).not.toBe(applicationId);
    expect(await reviewApplication(reapplied.applicationId, admin.id, 'accepted')).toMatchObject({ success: true });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
    const history = await db.select().from(shiftAssignments).where(and(
      eq(shiftAssignments.shiftId, shiftId), eq(shiftAssignments.employeeId, employee.id),
    ));
    expect(history).toHaveLength(2);
    expect(history.find(item => item.id === assignment.id)).toEqual(cancelledAssignment);
    expect(history.find(item => item.applicationId === reapplied.applicationId)).toMatchObject({ status: 'assigned' });
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.id, applicationId)))[0]).toEqual(acceptedApplication);
    await db.update(shifts).set({ startAt: new Date(Date.now() - 1_000) }).where(eq(shifts.id, shiftId));
    expect(await cancelAssignment(assignment.id, admin.id)).toMatchObject({ success: true, replayed: true });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
  });

  it.each(['open', 'cancelled', 'completed'] as const)('does not change a %s shift when cancelling an assignment', async status => {
    const { shiftId, assignment } = await assigned();
    await db.update(shifts).set({ status }).where(eq(shifts.id, shiftId));
    expect(await cancelAssignment(assignment.id, admin.id)).toMatchObject({ success: true });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe(status);
  });

  it('keeps an already overfilled shift filled until capacity is actually available', async () => {
    const { shiftId, assignment } = await assigned();
    const other = await identity('employee');
    await db.insert(shiftAssignments).values({ shiftId, employeeId: other.id, assignedBy: admin.id });
    expect(await cancelAssignment(assignment.id, admin.id)).toMatchObject({ success: true });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
  });

  it.each(['scheduled start', 'check-in', 'checked-out history', 'completed assignment'] as const)(
    'blocks cancellation after %s without writes', async reason => {
      const { shiftId, assignment } = await assigned();
      const expectedCode = reason === 'scheduled start' ? 'SHIFT_STARTED'
        : reason === 'completed assignment' ? 'ASSIGNMENT_STATE_CONFLICT' : 'ATTENDANCE_EXISTS';
      if (reason === 'scheduled start') {
        await db.update(shifts).set({ startAt: new Date(Date.now() - 1_000) }).where(eq(shifts.id, shiftId));
      } else if (reason === 'completed assignment') {
        await db.update(shiftAssignments).set({ status: 'completed' }).where(eq(shiftAssignments.id, assignment.id));
        expect(await confirmAssignment(assignment.id, employee.id)).toBe(false);
      } else {
        await db.insert(attendanceRecords).values({
          shiftAssignmentId: assignment.id, checkInAt: new Date(),
          checkOutAt: reason === 'checked-out history' ? new Date() : null,
          attendanceStatus: reason === 'checked-out history' ? 'checked_out' : 'checked_in',
        });
      }
      const before = {
        assignments: await db.select().from(shiftAssignments).where(eq(shiftAssignments.shiftId, shiftId)),
        attendance: await db.select().from(attendanceRecords).where(eq(attendanceRecords.shiftAssignmentId, assignment.id)),
        logs: await db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id)),
        notices: await db.select().from(notifications).where(eq(notifications.relatedShiftId, shiftId)),
      };
      const response = await cancelShiftAssignment(request('/api/admin/assignments/cancel', admin, {}), { params: { id: assignment.id } });
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ code: expectedCode });
      expect(await db.select().from(shiftAssignments).where(eq(shiftAssignments.shiftId, shiftId))).toEqual(before.assignments);
      expect(await db.select().from(attendanceRecords).where(eq(attendanceRecords.shiftAssignmentId, assignment.id))).toEqual(before.attendance);
      expect(await db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id))).toEqual(before.logs);
      expect(await db.select().from(notifications).where(eq(notifications.relatedShiftId, shiftId))).toEqual(before.notices);
      expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
    }
  );

  it('enforces cancellation session roles, CSRF, UUID and not-found contracts', async () => {
    const { assignment } = await assigned();
    const supervisor = await identity('supervisor');
    for (const [user, enabled, status] of [
      [undefined, true, 401], [employee, true, 403], [supervisor, true, 403], [admin, false, 403],
    ] as const) {
      expect((await cancelShiftAssignment(request('/api/admin/assignments/cancel', user, {}, enabled),
        { params: { id: assignment.id } })).status).toBe(status);
    }
    const invalid = await cancelShiftAssignment(request('/api/admin/assignments/cancel', admin, {}), { params: { id: 'invalid' } });
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toMatchObject({ code: 'INVALID_REQUEST' });
    const absent = await cancelShiftAssignment(request('/api/admin/assignments/cancel', admin, {}), { params: { id: crypto.randomUUID() } });
    expect(absent.status).toBe(404);
    expect(await absent.json()).toMatchObject({ code: 'ASSIGNMENT_NOT_FOUND' });
    const success = await cancelShiftAssignment(request('/api/admin/assignments/cancel', admin, {}), { params: { id: assignment.id } });
    expect(success.status).toBe(200);
    expect(await success.json()).toMatchObject({ code: 'ASSIGNMENT_CANCELLED', replayed: false });
    const replay = await cancelShiftAssignment(request('/api/admin/assignments/cancel', admin, {}), { params: { id: assignment.id } });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
  });

  it.each(['audit', 'notification', 'notification audit'] as const)('rolls back all cancellation writes on %s failure', async source => {
    const { shiftId, assignment } = await assigned();
    const before = {
      logs: await db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id)),
      notices: await db.select().from(notifications).where(eq(notifications.relatedShiftId, shiftId)),
    };
    if (source === 'audit') {
      vi.spyOn(audit, 'logAuditEvent').mockRejectedValueOnce(new Error('Synthetic audit failure'));
    } else if (source === 'notification') {
      const createNotification = notices.createNotificationIdempotent;
      vi.spyOn(notices, 'createNotificationIdempotent').mockImplementationOnce(async (input, executor) => {
        await createNotification(input, executor);
        throw new Error('Synthetic failure after notification insert');
      });
    } else {
      const logAuditEvent = audit.logAuditEvent;
      vi.spyOn(audit, 'logAuditEvent').mockImplementation(async (event, executor) => {
        await logAuditEvent(event, executor);
        if (event.entityType === 'notifications') throw new Error('Synthetic failure after notification audit');
      });
    }
    const result = await cancelShiftAssignment(request('/api/admin/assignments/cancel', admin, {}), { params: { id: assignment.id } });
    expect(result.status).toBe(500);
    expect(await result.json()).toMatchObject({ code: 'INTERNAL_ERROR', error: 'Annuleren van indeling mislukt' });
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, assignment.id)))[0]).toEqual(assignment);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
    expect(await db.select().from(auditLogs).where(eq(auditLogs.actorId, admin.id))).toEqual(before.logs);
    expect(await db.select().from(notifications).where(eq(notifications.relatedShiftId, shiftId))).toEqual(before.notices);
    vi.restoreAllMocks();
    expect(await cancelAssignment(assignment.id, admin.id)).toMatchObject({ success: true, replayed: false });
  });

  it('serializes cancellation against approval of another candidate without exceeding capacity', async () => {
    const { shiftId, assignment } = await assigned();
    const other = await identity('employee');
    const [pendingApplication] = await db.insert(shiftApplications).values({ shiftId, employeeId: other.id }).returning();
    const [cancelled, approved] = await Promise.all([
      cancelAssignment(assignment.id, admin.id), reviewApplication(pendingApplication.id, admin.id, 'accepted'),
    ]);
    expect(cancelled.success).toBe(true);
    if (!approved.success) {
      expect(approved.code).toBe('SHIFT_UNAVAILABLE');
      expect(await reviewApplication(pendingApplication.id, admin.id, 'accepted')).toMatchObject({ success: true });
    }
    const active = await db.select().from(shiftAssignments).where(and(
      eq(shiftAssignments.shiftId, shiftId), inArray(shiftAssignments.status, ['assigned', 'confirmed']),
    ));
    expect(active).toHaveLength(1);
    expect(active[0].employeeId).toBe(other.id);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
  });

  it.each(['service', 'employee query', 'admin query'] as const)('serializes cancellation against %s check-in', async path => {
    const { shiftId, assignment } = await assigned();
    const checkIn = path === 'service' ? () => checkInCore(assignment.id, null, null, employee.id)
      : path === 'employee query' ? () => employeeCheckIn(employee.id, assignment.id, 0, 0)
      : async () => {
        try {
          await upsertAttendance(assignment.id, 'check_in', 0, 0, admin.id);
          return { success: true };
        } catch (error) {
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toBe('Cannot check in for an inactive assignment');
          return { success: false };
        }
      };
    const [cancelled, checkedIn] = await Promise.all([cancelAssignment(assignment.id, admin.id), checkIn()]);
    expect(Number(cancelled.success) + Number(checkedIn.success)).toBe(1);
    if (!cancelled.success) expect(cancelled.code).toBe('ATTENDANCE_EXISTS');
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, assignment.id)))[0].status)
      .toBe(cancelled.success ? 'cancelled' : path === 'admin query' ? 'assigned' : 'confirmed');
    expect(await db.select().from(attendanceRecords).where(eq(attendanceRecords.shiftAssignmentId, assignment.id)))
      .toHaveLength(checkedIn.success ? 1 : 0);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe(cancelled.success ? 'open' : 'filled');
  });

  it('does not resurrect a cancelled assignment during concurrent confirmation', async () => {
    const { assignment } = await assigned();
    const [cancelled] = await Promise.all([cancelAssignment(assignment.id, admin.id), confirmAssignment(assignment.id, employee.id)]);
    expect(cancelled.success).toBe(true);
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, assignment.id)))[0].status).toBe('cancelled');
    expect(await confirmAssignment(assignment.id, employee.id)).toBe(false);
  });

  it('enforces active assignment uniqueness directly under concurrent inserts', async () => {
    const { shiftId } = await pending();
    const results = await Promise.allSettled((['assigned', 'confirmed'] as const).map(status => db.insert(shiftAssignments).values({
      shiftId, employeeId: employee.id, assignedBy: admin.id, status,
    })));
    expect(results.filter(item => item.status === 'fulfilled')).toHaveLength(1);
    const failure = results.find(item => item.status === 'rejected');
    expect(failure?.status === 'rejected' ? failure.reason : null)
      .toMatchObject({ code: '23505', constraint: 'unique_active_shift_assignment_employee' });
    expect(await db.select().from(shiftAssignments).where(eq(shiftAssignments.shiftId, shiftId))).toHaveLength(1);
  });

  it('creates, lists, publishes once and applies through the actual authorized API handlers', async () => {
    const id = await draft();
    const hidden = await browseShifts(request('/api/employee/shifts?workType=delivery-integration', employee));
    expect((await hidden.json()).shifts.map((shift: { id: string }) => shift.id)).not.toContain(id);
    const list = await listAdminShifts(request('/api/admin/shifts?status=draft', admin));
    expect((await list.json()).shifts.map((shift: { id: string }) => shift.id)).toContain(id);

    const published = await Promise.all([1, 2].map(() => publishShift(
      request(`/api/admin/shifts/${id}/publish`, admin, {}), { params: { id } },
    )));
    expect(published.map((response) => response.status).sort()).toEqual([200, 409]);
    const visible = await browseShifts(request('/api/employee/shifts?workType=delivery-integration', employee));
    expect((await visible.json()).shifts.map((shift: { id: string }) => shift.id)).toContain(id);
    const applied = await applyShift(request(`/api/employee/shifts/${id}/apply`, employee, {}), {
      params: Promise.resolve({ id }),
    });
    expect(applied.status).toBe(201);
    expect(await applied.json()).toMatchObject({ code: 'APPLICATION_CREATED' });
    expect((await db.select().from(shiftApplications).where(and(
      eq(shiftApplications.shiftId, id), eq(shiftApplications.employeeId, employee.id),
    )))[0].status).toBe('pending');
    expect((await audit.getAuditLogs({ entityType: 'shifts', entityId: id })).total).toBe(2);
  });

  it('enforces real session roles, authentication, CSRF and validation before writes', async () => {
    expect((await createShift(request('/api/admin/shifts', undefined, input))).status).toBe(401);
    expect((await createShift(request('/api/admin/shifts', employee, input))).status).toBe(403);
    expect((await createShift(request('/api/admin/shifts', admin, input, false))).status).toBe(403);
    expect((await createShift(request('/api/admin/shifts', admin, { ...input, endAt: input.startAt }))).status).toBe(400);
    const id = await draft();
    for (const [user, enabled, status] of [
      [undefined, true, 401], [employee, true, 403], [admin, false, 403],
    ] as const) {
      expect((await publishShift(request(`/api/admin/shifts/${id}/publish`, user, {}, enabled), {
        params: { id },
      })).status).toBe(status);
    }
    expect((await applyShift(request(`/api/employee/shifts/${id}/apply`, admin, {}), {
      params: Promise.resolve({ id }),
    })).status).toBe(403);
    expect((await applyShift(request(`/api/employee/shifts/${id}/apply`, employee, {}, false), {
      params: Promise.resolve({ id }),
    })).status).toBe(403);
    expect((await db.select().from(shifts).where(eq(shifts.id, id)))[0].status).toBe('draft');
  });

  it.each(['accepted', 'rejected'] as const)('serializes pending cancellation against concurrent %s review', async (decision) => {
    const { shiftId, applicationId } = await pending();
    await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, shiftId));
    const [cancelled, reviewed] = await Promise.all([
      cancelPendingApplication(applicationId, employee.id),
      reviewApplication(applicationId, admin.id, decision),
    ]);
    expect(Number(cancelled.success) + Number(reviewed.success)).toBe(1);
    const [application] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, applicationId));
    expect(application.status).toBe(cancelled.success ? 'cancelled' : decision);
    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, applicationId));
    const notices = await db.select().from(notifications).where(eq(notifications.relatedApplicationId, applicationId));
    expect(assignments).toHaveLength(reviewed.success && decision === 'accepted' ? 1 : 0);
    expect(notices).toHaveLength(reviewed.success ? 1 : 0);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status)
      .toBe(reviewed.success && decision === 'accepted' ? 'filled' : 'open');
    expect((await audit.getAuditLogs({ entityType: 'shift_applications', entityId: applicationId })).total).toBe(2);
  });

  it('reviews with real administrator sessions, fills capacity and replays without new effects', async () => {
    const { shiftId, applicationId } = await pending();
    await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, shiftId));
    const review = (user?: Identity, csrfEnabled = true, status = 'accepted') =>
      reviewShiftApplication(request(`/api/admin/applications/${applicationId}/review`, user, { status }, csrfEnabled), {
        params: { id: applicationId },
      });
    expect((await review()).status).toBe(401);
    expect((await review(employee)).status).toBe(403);
    expect((await review(admin, false)).status).toBe(403);
    const approved = await review(admin);
    expect(approved.status).toBe(200);
    expect(await approved.json()).toMatchObject({ code: 'APPLICATION_REVIEWED', replayed: false });
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');
    const replay = await review(admin);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true });
    const conflict = await review(admin, true, 'rejected');
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: 'APPLICATION_DECISION_CONFLICT' });
    expect(await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.applicationId, applicationId))).toHaveLength(1);
    expect(await db.select().from(notifications)
      .where(eq(notifications.relatedApplicationId, applicationId))).toHaveLength(1);
  });

  it('rolls back publication and application creation on audit failure and releases the apply lock', async () => {
    const id = await draft();
    const failure = vi.spyOn(audit, 'logAuditEvent').mockRejectedValue(new Error('Synthetic audit failure'));
    const publishResponse = await publishShift(request(`/api/admin/shifts/${id}/publish`, admin, {}), { params: { id } });
    expect(publishResponse.status).toBe(500);
    expect((await db.select().from(shifts).where(eq(shifts.id, id)))[0].status).toBe('draft');
    failure.mockRestore();
    await publishShift(request(`/api/admin/shifts/${id}/publish`, admin, {}), { params: { id } });
    vi.spyOn(audit, 'logAuditEvent').mockRejectedValue(new Error('Synthetic audit failure'));
    expect(await applyForShiftWithLock(id, employee.id)).toMatchObject({ success: false, code: 'INTERNAL_ERROR' });
    expect(await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, id))).toHaveLength(0);
    expect(await (await sessions.getRedis()).get(`lock:shift:${id}:apply:${employee.id}`)).toBeNull();
    vi.restoreAllMocks();
    expect(await applyForShiftWithLock(id, employee.id)).toMatchObject({ success: true });
  });

  it('returns 503 without database writes when the Redis lock client is disconnected', async () => {
    const id = await draft();
    await publishShift(request(`/api/admin/shifts/${id}/publish`, admin, {}), { params: { id } });
    const disconnected = createClient({ url: process.env.REDIS_URL });
    disconnected.on('error', () => {});
    await disconnected.connect();
    await disconnected.quit();
    vi.spyOn(sessions, 'getRedis').mockResolvedValueOnce(disconnected);
    const response = await applyShift(request(`/api/employee/shifts/${id}/apply`, employee, {}), {
      params: Promise.resolve({ id }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'LOCK_UNAVAILABLE' });
    expect(await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, id))).toHaveLength(0);
  });
});
