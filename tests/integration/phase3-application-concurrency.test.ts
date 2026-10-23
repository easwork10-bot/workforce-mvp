import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/backend/db';
import { profiles, shifts, shiftApplications, shiftAssignments, attendanceRecords, auditLogs } from '@/backend/db/schema';
import { applyForShiftWithLock } from '@/backend/db/queries/applications';
import { getAuditLogs } from '@/backend/db/queries/audit';
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
    expect(r2.message).toContain('al gesolliciteerd');
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
});
