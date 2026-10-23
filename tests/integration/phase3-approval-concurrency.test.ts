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
    expect(failed[0].message).toContain('vol');

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

    // Accept second application
    const r2 = await reviewApplication(apps[1].id, adminId, 'accepted');
    expect(r2.success).toBe(true);

    // Third should fail - capacity reached
    const r3 = await reviewApplication(apps[2].id, adminId, 'accepted');
    expect(r3.success).toBe(false);
    expect(r3.message).toContain('vol');

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
});
