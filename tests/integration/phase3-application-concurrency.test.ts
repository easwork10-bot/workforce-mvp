import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/backend/db';
import { profiles, shifts, shiftApplications, shiftAssignments, attendanceRecords, auditLogs } from '@/backend/db/schema';
import { applyForShiftWithLock, cancelPendingApplication, getApplications } from '@/backend/db/queries/applications';
import { getAuditLogs } from '@/backend/db/queries/audit';
import { getRedis } from '@/backend/auth/session';
import { eq } from 'drizzle-orm';

const uniqueEmail = (base: string) => `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@workforce.test`;

describe('Phase 3 Employee API - Shift Application Concurrency', () => {
  let testEmployeeId: string;
  let testEmployeeId2: string;
  let testShiftId: string;

  beforeAll(async () => {
    await db.delete(auditLogs);
    await db.delete(attendanceRecords);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  beforeEach(async () => {
    const [emp1] = await db.insert(profiles).values({
      fullName: 'Concurrent Test 1',
      email: uniqueEmail('concurrent1'),
    }).returning();
    testEmployeeId = emp1.id;

    const [emp2] = await db.insert(profiles).values({
      fullName: 'Concurrent Test 2',
      email: uniqueEmail('concurrent2'),
    }).returning();
    testEmployeeId2 = emp2.id;

    const [shift] = await db.insert(shifts).values({
      title: 'Concurrent Shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 2,
      createdBy: testEmployeeId,
      status: 'open',
    }).returning();
    testShiftId = shift.id;
  });

  afterAll(async () => {
    await db.delete(auditLogs);
    await db.delete(attendanceRecords);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  it('should allow concurrent applications from DIFFERENT users (per-user lock)', async () => {
    // This test verifies the lock is scoped per-user
    // Both should succeed because they have different employeeIds = different lock keys
    const [r1, r2] = await Promise.all([
      applyForShiftWithLock(testShiftId, testEmployeeId),
      applyForShiftWithLock(testShiftId, testEmployeeId2),
    ]);

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);

    // Verify both applications exist
    const apps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    expect(apps.length).toBe(2);
    expect((await getAuditLogs({
      actorId: testEmployeeId,
      entityType: 'shift_applications',
    })).total).toBe(1);
    expect((await getAuditLogs({
      actorId: testEmployeeId2,
      entityType: 'shift_applications',
    })).total).toBe(1);
  });

  it('should reject duplicate application from SAME user', async () => {
    const r1 = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(r1.success).toBe(true);

    const r2 = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(r2.success).toBe(false);
    expect(r2.code).toBe('DUPLICATE_APPLICATION');
    expect((await getAuditLogs({
      actorId: testEmployeeId,
      entityType: 'shift_applications',
    })).total).toBe(1);
  });

  it('should reject application when shift at capacity (requiredWorkers)', async () => {
    // Fill the shift with assignments (capacity = 2)
    await db.insert(shiftAssignments).values([
      {
        shiftId: testShiftId,
        employeeId: testEmployeeId,
        status: 'assigned',
        assignedBy: testEmployeeId,
      },
      {
        shiftId: testShiftId,
        employeeId: testEmployeeId2,
        status: 'assigned',
        assignedBy: testEmployeeId,
      },
    ]);

    // Shift requires 2 workers, 2 assigned - at capacity
    const [emp3] = await db.insert(profiles).values({
      fullName: 'Concurrent Test 3',
      email: uniqueEmail('concurrent3'),
    }).returning();

    const r2 = await applyForShiftWithLock(testShiftId, emp3.id);
    expect(r2.success).toBe(false);
    expect(r2.message).toContain('vol');
  });

  it('should reject application for non-open shift', async () => {
    // Close the shift
    await db.update(shifts).set({ status: 'filled' }).where(eq(shifts.id, testShiftId));

    const result = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(result.success).toBe(false);
    expect(result.message).toContain('niet open');
  });

  it('should reject application for already assigned employee', async () => {
    await db.insert(shiftAssignments).values({
      shiftId: testShiftId,
      employeeId: testEmployeeId,
      status: 'assigned',
      assignedBy: testEmployeeId,
    });

    const result = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(result.success).toBe(false);
    expect(result.message).toContain('al ingedeeld');
  });

  it('allows rejected and cancelled attempts to be reapplied while preserving history', async () => {
    const first = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(first.success).toBe(true);
    if (!first.success) return;

    await db.update(shiftApplications)
      .set({ status: 'rejected', appliedAt: new Date('2026-01-01T10:00:00Z') })
      .where(eq(shiftApplications.id, first.applicationId));

    const second = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(second.success).toBe(true);
    if (!second.success) return;

    await db.update(shiftApplications)
      .set({ status: 'cancelled', appliedAt: new Date('2026-02-01T10:00:00Z') })
      .where(eq(shiftApplications.id, second.applicationId));

    const third = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(third.success).toBe(true);
    if (!third.success) return;

    await db.update(shiftApplications)
      .set({ appliedAt: new Date('2026-03-01T10:00:00Z') })
      .where(eq(shiftApplications.id, third.applicationId));

    const history = await getApplications({
      employeeId: testEmployeeId,
      page: 1,
      limit: 10,
    });
    expect(history.data.map((application) => application.id)).toEqual([
      third.applicationId,
      second.applicationId,
      first.applicationId,
    ]);
    expect(history.data.map((application) => application.status)).toEqual([
      'pending',
      'cancelled',
      'rejected',
    ]);
    expect(new Set(history.data.map((application) => application.id)).size).toBe(3);
    expect((await getAuditLogs({
      actorId: testEmployeeId,
      entityType: 'shift_applications',
    })).total).toBe(3);
  });

  it('cancels a pending attempt without deleting it and permits a new attempt', async () => {
    const first = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(first.success).toBe(true);
    if (!first.success) return;

    const cancelled = await cancelPendingApplication(first.applicationId, testEmployeeId);
    expect(cancelled).toMatchObject({ success: true, code: 'APPLICATION_CANCELLED' });

    const next = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(next.success).toBe(true);
    if (!next.success) return;

    const attempts = await db.select().from(shiftApplications)
      .where(eq(shiftApplications.shiftId, testShiftId));
    expect(attempts.map((attempt) => attempt.status)).toContain('cancelled');
    expect(attempts.map((attempt) => attempt.status)).toContain('pending');
    expect(attempts).toHaveLength(2);
    expect((await getAuditLogs({
      actorId: testEmployeeId,
      entityType: 'shift_applications',
    })).total).toBe(3);
  });

  it('allows applying after the scheduled start while the shift remains open', async () => {
    await db.update(shifts)
      .set({ startAt: new Date('2000-01-01T09:00:00Z'), endAt: new Date('2000-01-01T17:00:00Z') })
      .where(eq(shifts.id, testShiftId));

    const result = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(result).toMatchObject({ success: true, code: 'APPLICATION_CREATED' });
  });

  it.each(['draft', 'filled', 'cancelled', 'completed'] as const)(
    'rejects applications when the shift status is %s',
    async (status) => {
      await db.update(shifts).set({ status }).where(eq(shifts.id, testShiftId));

      const result = await applyForShiftWithLock(testShiftId, testEmployeeId);
      expect(result).toMatchObject({ success: false, code: 'SHIFT_UNAVAILABLE' });
    }
  );

  it('treats a cancelled assignment as history rather than an active assignment', async () => {
    await db.insert(shiftAssignments).values({
      shiftId: testShiftId,
      employeeId: testEmployeeId,
      status: 'cancelled',
      assignedBy: testEmployeeId,
    });

    const result = await applyForShiftWithLock(testShiftId, testEmployeeId);
    expect(result).toMatchObject({ success: true, code: 'APPLICATION_CREATED' });
  });

  it('creates at most one pending application under concurrent duplicate requests', async () => {
    const results = await Promise.all([
      applyForShiftWithLock(testShiftId, testEmployeeId),
      applyForShiftWithLock(testShiftId, testEmployeeId),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => !result.success)).toHaveLength(1);
    expect(results.find((result) => !result.success)?.code)
      .toMatch(/^(LOCK_CONTENDED|DUPLICATE_APPLICATION)$/);
    expect((await db.select().from(shiftApplications)
      .where(eq(shiftApplications.shiftId, testShiftId)))).toHaveLength(1);
    expect((await getAuditLogs({
      actorId: testEmployeeId,
      entityType: 'shift_applications',
    })).total).toBe(1);
  });

  it('rejects Redis lock contention without entering the application flow', async () => {
    const redis = await getRedis();
    const key = `lock:shift:${testShiftId}:apply:${testEmployeeId}`;
    const owner = crypto.randomUUID();
    expect(await redis.set(key, owner, { NX: true, PX: 15000 })).toBe('OK');

    try {
      const result = await applyForShiftWithLock(testShiftId, testEmployeeId);
      expect(result).toMatchObject({ success: false, code: 'LOCK_CONTENDED' });
      expect(await db.select().from(shiftApplications)
        .where(eq(shiftApplications.shiftId, testShiftId))).toHaveLength(0);
    } finally {
      await redis.eval(
        `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end return 0`,
        { keys: [key], arguments: [owner] }
      );
    }
  });
});
