import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { db } from '@/backend/db';
import { profiles, shifts, shiftApplications, shiftAssignments, notifications, attendanceRecords, auditLogs } from '@/backend/db/schema';
import { reviewApplication } from '@/backend/db/queries/applications';
import { eq, and, inArray } from 'drizzle-orm';

const uniqueEmail = (base: string) => `${base}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@workforce.test`;

describe('Phase 3 Employee API - Concurrent Approval (Capacity Enforcement)', () => {
  let adminId: string;
  let testEmployeeIds: string[];
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
    // Create admin user
    const [admin] = await db.insert(profiles).values({
      fullName: 'Admin User',
      email: uniqueEmail('admin'),
      role: 'administrator',
    }).returning();
    adminId = admin.id;

    // Create 3 test employees (shift requires 2 workers)
    testEmployeeIds = [];
    for (let i = 1; i <= 3; i++) {
      const [emp] = await db.insert(profiles).values({
        fullName: `Concurrent Employee ${i}`,
        email: uniqueEmail(`concurrent${i}`),
      }).returning();
      testEmployeeIds.push(emp.id);
    }

    // Create shift requiring exactly 2 workers
    const [shift] = await db.insert(shifts).values({
      title: 'Concurrent Approval Shift',
      workType: 'cleaning',
      location: 'Amsterdam',
      startAt: new Date('2099-01-01T09:00:00Z'),
      endAt: new Date('2099-01-01T17:00:00Z'),
      requiredWorkers: 2,
      createdBy: adminId,
      status: 'open',
    }).returning();
    testShiftId = shift.id;

    // Each employee applies for the shift
    for (const empId of testEmployeeIds) {
      await db.insert(shiftApplications).values({
        shiftId: testShiftId,
        employeeId: empId,
        status: 'pending',
      });
    }
  });

  afterAll(async () => {
    await db.delete(auditLogs);
    await db.delete(attendanceRecords);
    await db.delete(shiftAssignments);
    await db.delete(shiftApplications);
    await db.delete(shifts);
    await db.delete(profiles);
  });

  it('should enforce capacity with concurrent approvals - only 2 of 3 accepted', async () => {
    // Get all applications
    const apps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    expect(apps.length).toBe(3);

    // Simulate concurrent approval of all 3 applications
    // Use Promise.all to trigger race condition
    const results = await Promise.all(
      apps.map(app => reviewApplication(app.id, adminId, 'accepted'))
    );

    // Exactly 2 should succeed, 1 should fail due to capacity
    const successful = results.filter(r => r.success);
    const failed = results.filter(r => !r.success);

    expect(successful.length).toBe(2);
    expect(failed.length).toBe(1);
    expect(failed[0]).toMatchObject({ code: 'SHIFT_UNAVAILABLE' });
    expect((await db.select().from(shifts).where(eq(shifts.id, testShiftId)))[0].status).toBe('filled');

    // Verify database state: exactly 2 assignments created
    const assignments = await db
      .select()
      .from(shiftAssignments)
      .where(and(
        eq(shiftAssignments.shiftId, testShiftId),
        inArray(shiftAssignments.status, ['assigned', 'confirmed'])
      ));
    expect(assignments.length).toBe(2);

    // Verify all 3 applications have status (2 accepted, 1 remains pending due to capacity failure)
    // The failed transaction rolls back, so the 3rd application stays "pending"
    const updatedApps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    const acceptedApps = updatedApps.filter(a => a.status === 'accepted');
    const pendingApps = updatedApps.filter(a => a.status === 'pending');
    expect(acceptedApps.length).toBe(2);
    expect(pendingApps.length).toBe(1);
  });

  it('should enforce capacity when accepting sequentially after one filled', async () => {
    // Create a fresh shift with capacity 2
    const [shift] = await db.insert(shifts).values({
      title: 'Sequential Fill Shift',
      workType: 'security',
      location: 'Rotterdam',
      startAt: new Date('2099-02-01T09:00:00Z'),
      endAt: new Date('2099-02-01T17:00:00Z'),
      requiredWorkers: 2,
      createdBy: adminId,
      status: 'open',
    }).returning();
    const shiftId = shift.id;

    // Create 3 applicants
    const applicantIds: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const [emp] = await db.insert(profiles).values({
        fullName: `Seq Employee ${i}`,
        email: uniqueEmail(`seq${i}`),
      }).returning();
      applicantIds.push(emp.id);

      await db.insert(shiftApplications).values({
        shiftId,
        employeeId: emp.id,
        status: 'pending',
      });
    }

    // Accept first application
    const apps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, shiftId));
    const r1 = await reviewApplication(apps[0].id, adminId, 'accepted');
    expect(r1.success).toBe(true);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('open');

    // Accept second application
    const r2 = await reviewApplication(apps[1].id, adminId, 'accepted');
    expect(r2.success).toBe(true);
    expect((await db.select().from(shifts).where(eq(shifts.id, shiftId)))[0].status).toBe('filled');

    // Third should fail - capacity reached
    const r3 = await reviewApplication(apps[2].id, adminId, 'accepted');
    expect(r3.success).toBe(false);
    expect(r3).toMatchObject({ code: 'SHIFT_UNAVAILABLE' });

    // Verify exactly 2 assignments
    const assignments = await db
      .select()
      .from(shiftAssignments)
      .where(and(
        eq(shiftAssignments.shiftId, shiftId),
        inArray(shiftAssignments.status, ['assigned', 'confirmed'])
      ));
    expect(assignments.length).toBe(2);
  });

  it('replays the same final decision without changing reviewer or timestamp', async () => {
    const [application] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.employeeId, testEmployeeIds[0]))
      .limit(1);

    const first = await reviewApplication(application.id, adminId, 'accepted');
    expect(first.success).toBe(true);

    const [firstState] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, application.id)).limit(1);
    const replay = await reviewApplication(application.id, testEmployeeIds[1], 'accepted');
    const [replayedState] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, application.id)).limit(1);

    expect(replay.success).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(replayedState.reviewedBy).toBe(firstState.reviewedBy);
    expect(replayedState.reviewedAt).toEqual(firstState.reviewedAt);

    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id));
    const eventNotifications = await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id));
    expect(assignments).toHaveLength(1);
    expect(eventNotifications).toHaveLength(1);
    expect(eventNotifications[0].type).toBe('application_accepted');

    const changedOutcome = await reviewApplication(application.id, adminId, 'rejected');
    expect(changedOutcome.success).toBe(false);
    expect(changedOutcome.conflict).toBe(true);
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id))).length).toBe(1);
    expect((await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id))).length).toBe(1);
  });

  it('replays rejection without creating an assignment or duplicate notification', async () => {
    const [application] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.employeeId, testEmployeeIds[1]))
      .limit(1);

    const first = await reviewApplication(application.id, adminId, 'rejected', 'Not available');
    expect(first.success).toBe(true);
    const [firstState] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, application.id)).limit(1);

    const replay = await reviewApplication(application.id, testEmployeeIds[0], 'rejected', 'Not available');
    const [replayedState] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, application.id)).limit(1);
    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id));
    const eventNotifications = await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id));

    expect(replay.success).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(replayedState.status).toBe('rejected');
    expect(replayedState.reviewedBy).toBe(firstState.reviewedBy);
    expect(replayedState.reviewedAt).toEqual(firstState.reviewedAt);
    expect(assignments).toHaveLength(0);
    expect(eventNotifications).toHaveLength(1);
    expect(eventNotifications[0].type).toBe('application_rejected');
    expect(eventNotifications[0].message).toContain('Not available');

    const payloadConflict = await reviewApplication(application.id, adminId, 'rejected', 'Different reason');
    expect(payloadConflict.success).toBe(false);
    expect(payloadConflict.conflict).toBe(true);
    expect((await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id))).length).toBe(1);
  });

  it('serializes competing accept/reject requests to one terminal outcome', async () => {
    const [application] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.employeeId, testEmployeeIds[0]))
      .limit(1);

    const results = await Promise.all([
      reviewApplication(application.id, adminId, 'accepted'),
      reviewApplication(application.id, testEmployeeIds[1], 'rejected', 'Not available'),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => result.conflict)).toHaveLength(1);

    const [finalApplication] = await db.select().from(shiftApplications).where(eq(shiftApplications.id, application.id)).limit(1);
    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id));
    const eventNotifications = await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id));

    expect(['accepted', 'rejected']).toContain(finalApplication.status);
    expect(assignments).toHaveLength(finalApplication.status === 'accepted' ? 1 : 0);
    expect(eventNotifications).toHaveLength(1);
    expect(eventNotifications[0].type).toBe(
      finalApplication.status === 'accepted' ? 'application_accepted' : 'application_rejected'
    );
  });

  it('replays the same terminal outcome without changing review metadata or duplicating effects', async () => {
    const [application] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.employeeId, testEmployeeIds[0]))
      .limit(1);

    const first = await reviewApplication(application.id, adminId, 'accepted');
    expect(first.success).toBe(true);

    const [afterFirstReview] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.id, application.id))
      .limit(1);
    const replay = await reviewApplication(application.id, testEmployeeIds[1], 'accepted');

    expect(replay.success).toBe(true);
    expect(replay.replayed).toBe(true);

    const [afterReplay] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.id, application.id))
      .limit(1);
    expect(afterReplay.status).toBe('accepted');
    expect(afterReplay.reviewedBy).toBe(afterFirstReview.reviewedBy);
    expect(afterReplay.reviewedAt).toEqual(afterFirstReview.reviewedAt);

    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id));
    const applicationNotifications = await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id));
    expect(assignments).toHaveLength(1);
    expect(applicationNotifications).toHaveLength(1);
    expect(applicationNotifications[0].type).toBe('application_accepted');

    const changedOutcome = await reviewApplication(application.id, adminId, 'rejected');
    expect(changedOutcome.success).toBe(false);
    expect(changedOutcome.conflict).toBe(true);
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id))).length).toBe(1);
    expect((await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id))).length).toBe(1);
  });

  it('serializes competing accept/reject decisions into one final state and one notification', async () => {
    const [application] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.employeeId, testEmployeeIds[0]))
      .limit(1);

    const results = await Promise.all([
      reviewApplication(application.id, adminId, 'accepted'),
      reviewApplication(application.id, testEmployeeIds[1], 'rejected', 'Not available'),
    ]);

    expect(results.filter((result) => result.success)).toHaveLength(1);
    expect(results.filter((result) => result.conflict)).toHaveLength(1);

    const [finalApplication] = await db
      .select()
      .from(shiftApplications)
      .where(eq(shiftApplications.id, application.id))
      .limit(1);
    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, application.id));
    const applicationNotifications = await db.select().from(notifications).where(eq(notifications.relatedApplicationId, application.id));

    expect(['accepted', 'rejected']).toContain(finalApplication.status);
    expect(assignments).toHaveLength(finalApplication.status === 'accepted' ? 1 : 0);
    expect(applicationNotifications).toHaveLength(1);
    expect(applicationNotifications[0].type).toBe(
      finalApplication.status === 'accepted' ? 'application_accepted' : 'application_rejected'
    );
  });

  it('serializes two approvals for the last vacancy and audits the fill exactly once', async () => {
    await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, testShiftId));
    const apps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    const results = await Promise.all(apps.slice(0, 2).map(app => reviewApplication(app.id, adminId, 'accepted')));
    expect(results.filter(result => result.success)).toHaveLength(1);
    expect(results.find(result => !result.success)).toMatchObject({ code: 'SHIFT_UNAVAILABLE' });
    const assignments = await db.select().from(shiftAssignments).where(eq(shiftAssignments.shiftId, testShiftId));
    expect(assignments).toHaveLength(1);
    const winner = apps.find(app => app.id === assignments[0].applicationId);
    expect(assignments[0].employeeId).toBe(winner?.employeeId);
    expect((await db.select().from(shifts).where(eq(shifts.id, testShiftId)))[0].status).toBe('filled');
    const fillAudits = await db.select().from(auditLogs).where(and(
      eq(auditLogs.entityType, 'shifts'), eq(auditLogs.entityId, testShiftId)
    ));
    expect(fillAudits).toHaveLength(1);
    expect(fillAudits[0]).toMatchObject({ oldValues: { status: 'open' }, newValues: { status: 'filled' } });
    const beforeReplay = await db.select().from(auditLogs).where(eq(auditLogs.actorId, adminId));
    expect(await reviewApplication(assignments[0].applicationId!, adminId, 'accepted'))
      .toMatchObject({ success: true, replayed: true });
    expect(await db.select().from(auditLogs).where(eq(auditLogs.actorId, adminId))).toEqual(beforeReplay);
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId)))
      .filter(app => app.status === 'pending')).toHaveLength(2);
  });

  it('approves after the scheduled start while open without counting pending applications', async () => {
    await db.update(shifts).set({
      startAt: new Date('2000-01-01T09:00:00Z'), endAt: new Date('2000-01-01T17:00:00Z'),
    }).where(eq(shifts.id, testShiftId));
    const [app] = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    expect(await reviewApplication(app.id, adminId, 'accepted')).toMatchObject({ success: true });
    expect((await db.select().from(shifts).where(eq(shifts.id, testShiftId)))[0].status).toBe('open');
    expect(await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, app.id))).toHaveLength(1);
  });

  it.each(['cancelled', 'completed'] as const)(
    'does not count another employee %s assignment toward occupied capacity',
    async (status) => {
      await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, testShiftId));
      await db.insert(shiftAssignments).values({
        shiftId: testShiftId, employeeId: testEmployeeIds[2], assignedBy: adminId, status,
      });
      const [app] = await db.select().from(shiftApplications).where(and(
        eq(shiftApplications.shiftId, testShiftId), eq(shiftApplications.employeeId, testEmployeeIds[0])
      ));
      expect(await reviewApplication(app.id, adminId, 'accepted')).toMatchObject({ success: true });
      expect((await db.select().from(shifts).where(eq(shifts.id, testShiftId)))[0].status).toBe('filled');
    }
  );

  it('counts confirmed assignments and rejects an already actively assigned employee', async () => {
    await db.insert(shiftAssignments).values({
      shiftId: testShiftId, employeeId: testEmployeeIds[0], assignedBy: adminId, status: 'confirmed',
    });
    const apps = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    const duplicate = apps.find(app => app.employeeId === testEmployeeIds[0])!;
    expect(await reviewApplication(duplicate.id, adminId, 'accepted'))
      .toMatchObject({ code: 'ACTIVE_ASSIGNMENT_EXISTS', success: false });
    const other = apps.find(app => app.employeeId === testEmployeeIds[1])!;
    expect(await reviewApplication(other.id, adminId, 'accepted')).toMatchObject({ success: true });
    expect((await db.select().from(shifts).where(eq(shifts.id, testShiftId)))[0].status).toBe('filled');
  });

  it('preserves historical applications and allows a replacement after a cancelled assignment', async () => {
    const [app] = await db.select().from(shiftApplications).where(and(
      eq(shiftApplications.shiftId, testShiftId), eq(shiftApplications.employeeId, testEmployeeIds[0])
    ));
    const [history] = await db.insert(shiftApplications).values({
      shiftId: testShiftId, employeeId: app.employeeId, status: 'rejected',
      reviewedBy: adminId, reviewedAt: new Date('2026-01-01T09:00:00Z'), rejectionReason: 'Fixture',
    }).returning();
    const [oldAssignment] = await db.insert(shiftAssignments).values({
      shiftId: testShiftId, employeeId: app.employeeId, assignedBy: adminId, status: 'cancelled',
    }).returning();
    expect(await reviewApplication(app.id, adminId, 'accepted'))
      .toMatchObject({ success: true, code: 'APPLICATION_REVIEWED' });
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.id, history.id)))[0]).toEqual(history);
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.id, app.id)))[0].status).toBe('accepted');
    expect((await db.select().from(shiftAssignments).where(eq(shiftAssignments.id, oldAssignment.id)))[0]).toEqual(oldAssignment);
    expect(await db.select().from(shiftAssignments).where(eq(shiftAssignments.employeeId, app.employeeId))).toHaveLength(2);
  });

  it('links approval to the pending attempt without rewriting previous rejection history', async () => {
    const [app] = await db.select().from(shiftApplications).where(and(
      eq(shiftApplications.shiftId, testShiftId), eq(shiftApplications.employeeId, testEmployeeIds[0])
    ));
    const [history] = await db.insert(shiftApplications).values({
      shiftId: testShiftId, employeeId: app.employeeId, status: 'rejected',
      reviewedBy: adminId, reviewedAt: new Date('2026-01-01T09:00:00Z'), rejectionReason: 'Fixture',
    }).returning();
    expect(await reviewApplication(app.id, adminId, 'accepted')).toMatchObject({ success: true });
    expect((await db.select().from(shiftApplications).where(eq(shiftApplications.id, history.id)))[0]).toEqual(history);
    expect((await db.select().from(shiftAssignments)
      .where(eq(shiftAssignments.employeeId, app.employeeId)))[0].applicationId).toBe(app.id);
  });

  it('replays simultaneous identical approvals of the final vacancy without duplicate effects', async () => {
    await db.update(shifts).set({ requiredWorkers: 1 }).where(eq(shifts.id, testShiftId));
    const [app] = await db.select().from(shiftApplications).where(eq(shiftApplications.shiftId, testShiftId));
    const results = await Promise.all([
      reviewApplication(app.id, adminId, 'accepted'),
      reviewApplication(app.id, adminId, 'accepted'),
    ]);
    expect(results.every(result => result.success)).toBe(true);
    expect(results.filter(result => result.replayed)).toHaveLength(1);
    expect(await db.select().from(shiftAssignments).where(eq(shiftAssignments.applicationId, app.id))).toHaveLength(1);
    expect(await db.select().from(notifications).where(eq(notifications.relatedApplicationId, app.id))).toHaveLength(1);
    expect(await db.select().from(auditLogs).where(eq(auditLogs.actorId, adminId))).toHaveLength(4);
  });
});
