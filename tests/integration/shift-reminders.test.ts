import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool } from '@/backend/db';
import {
  auditLogs,
  notifications,
  profiles,
  shiftAssignments,
  shifts,
} from '@/backend/db/schema';
import * as auditQueries from '@/backend/db/queries/audit';
import {
  getUpcomingShiftReminderOccurrences,
  sendShiftReminders,
  startShiftReminderJob,
  stopShiftReminderJob,
  type ShiftReminderOccurrence,
} from '@/backend/jobs/shiftReminders';

const realSetTimeout = globalThis.setTimeout;

describe('shift reminder background job', () => {
  const profileIds: string[] = [];
  const shiftIds: string[] = [];
  const assignmentIds: string[] = [];

  beforeAll(async () => {
    const databaseUrl = new URL(process.env.DATABASE_URL || '');
    expect(databaseUrl.pathname).toBe('/workforce_test');
    expect(['localhost', '127.0.0.1', '::1']).toContain(databaseUrl.hostname);

    const { rows } = await pool.query('SELECT current_database() AS database');
    expect(rows[0]?.database).toBe('workforce_test');
  });

  afterEach(async () => {
    stopShiftReminderJob();
    vi.useRealTimers();
    const relatedNotifications = shiftIds.length
      ? await db.select({ id: notifications.id })
          .from(notifications)
          .where(inArray(notifications.relatedShiftId, shiftIds))
      : [];
    const notificationIds = relatedNotifications.map(({ id }) => id);

    if (notificationIds.length) {
      await db.delete(auditLogs).where(and(
        eq(auditLogs.entityType, 'notifications'),
        inArray(auditLogs.entityId, notificationIds)
      ));
      await db.delete(notifications).where(inArray(notifications.id, notificationIds));
    }
    if (assignmentIds.length) {
      await db.delete(shiftAssignments).where(inArray(shiftAssignments.id, assignmentIds));
    }
    if (shiftIds.length) {
      await db.delete(shifts).where(inArray(shifts.id, shiftIds));
    }
    if (profileIds.length) {
      await db.delete(auditLogs).where(inArray(auditLogs.actorId, profileIds));
      await db.delete(profiles).where(inArray(profiles.id, profileIds));
    }

    assignmentIds.length = 0;
    shiftIds.length = 0;
    profileIds.length = 0;
    vi.restoreAllMocks();
  });

  async function createOccurrence({
    startAt,
    assignmentStatus = 'assigned',
    shiftStatus = 'open',
  }: {
    startAt: Date;
    assignmentStatus?: 'assigned' | 'confirmed' | 'cancelled' | 'completed';
    shiftStatus?: 'draft' | 'open' | 'filled' | 'cancelled' | 'completed';
  }): Promise<ShiftReminderOccurrence> {
    const [administrator] = await db.insert(profiles).values({
      fullName: 'Reminder test administrator',
      email: `reminder-admin-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    const [employee] = await db.insert(profiles).values({
      fullName: 'Reminder test employee',
      email: `reminder-employee-${crypto.randomUUID()}@workforce.test`,
    }).returning();
    profileIds.push(administrator.id, employee.id);

    const [shift] = await db.insert(shifts).values({
      title: 'Reminder test shift',
      workType: 'cleaning',
      location: 'Test location',
      startAt,
      endAt: new Date(startAt.getTime() + 8 * 60 * 60 * 1000),
      requiredWorkers: 1,
      status: shiftStatus,
      createdBy: administrator.id,
    }).returning();
    shiftIds.push(shift.id);

    const [assignment] = await db.insert(shiftAssignments).values({
      shiftId: shift.id,
      employeeId: employee.id,
      assignedBy: administrator.id,
      status: assignmentStatus,
    }).returning();
    assignmentIds.push(assignment.id);

    return {
      assignmentId: assignment.id,
      shiftId: shift.id,
      recipientId: employee.id,
      startAt,
    };
  }

  function runAtDueTime(occurrence: ShiftReminderOccurrence) {
    return sendShiftReminders(
      [occurrence],
      new Date(occurrence.startAt.getTime() - 24 * 60 * 60 * 1000)
    );
  }

  function waitForDatabaseWork(): Promise<void> {
    return new Promise((resolve) => realSetTimeout(resolve, 100));
  }

  it('selects only eligible assignments inside the future scheduling window', async () => {
    const now = new Date('2040-01-01T00:00:00.000Z');
    const leadTime = 24 * 60 * 60 * 1000;
    const boundaryOccurrences = await Promise.all([
      createOccurrence({ startAt: new Date(now.getTime() + leadTime + 1) }),
      createOccurrence({ startAt: new Date(now.getTime() + 2 * leadTime), assignmentStatus: 'confirmed' }),
      createOccurrence({ startAt: new Date(now.getTime() + leadTime), assignmentStatus: 'assigned' }),
      createOccurrence({ startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000), assignmentStatus: 'cancelled' }),
      createOccurrence({ startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000), assignmentStatus: 'completed' }),
      createOccurrence({ startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000), shiftStatus: 'cancelled' }),
      createOccurrence({ startAt: new Date(now.getTime() + 2 * leadTime + 1) }),
    ]);

    const occurrences = await getUpcomingShiftReminderOccurrences(now);
    expect(occurrences.map(({ assignmentId }) => assignmentId).sort()).toEqual(
      [boundaryOccurrences[0].assignmentId, boundaryOccurrences[1].assignmentId].sort()
    );

    const afterMissedDueTime = new Date(now.getTime() + leadTime);
    const notLate = await getUpcomingShiftReminderOccurrences(afterMissedDueTime);
    expect(notLate.some(({ assignmentId }) => assignmentId === boundaryOccurrences[0].assignmentId)).toBe(false);
  });

  it('creates one idempotent reminder and one truthful system audit under concurrent execution', async () => {
    const startAt = new Date('2040-02-01T12:00:00.000Z');
    const occurrence = await createOccurrence({ startAt, assignmentStatus: 'confirmed' });

    const results = await Promise.all([
      runAtDueTime(occurrence),
      runAtDueTime(occurrence),
    ]);
    expect(results.reduce((sum, result) => sum + result.sent, 0)).toBe(1);
    expect(results.reduce((sum, result) => sum + result.errors, 0)).toBe(0);

    const createdNotifications = await db
      .select()
      .from(notifications)
      .where(and(
        eq(notifications.recipientId, occurrence.recipientId),
        eq(notifications.relatedShiftId, occurrence.shiftId)
      ));
    expect(createdNotifications).toHaveLength(1);
    expect(createdNotifications[0]).toMatchObject({
      type: 'check_in_reminder',
      idempotencyKey: `shift-reminder:check-in:v1:${occurrence.assignmentId}:${startAt.toISOString()}`,
    });

    const auditEntries = await db
      .select()
      .from(auditLogs)
      .where(eq(auditLogs.entityId, createdNotifications[0].id));
    expect(auditEntries).toHaveLength(1);
    expect(auditEntries[0]).toMatchObject({
      actorId: null,
      actorType: 'system',
      action: 'INSERT',
      entityType: 'notifications',
      newValues: {
        type: 'check_in_reminder',
        relatedShiftId: occurrence.shiftId,
        assignmentId: occurrence.assignmentId,
      },
    });
  });

  it('rebuilds pending timers on restart and skips occurrences due at restart', async () => {
    const now = new Date('2040-05-01T00:00:00.000Z');
    await createOccurrence({
      startAt: new Date(now.getTime() + 24 * 60 * 60 * 1000 + 30_000),
    });

    vi.useFakeTimers();
    vi.setSystemTime(now);
    startShiftReminderJob();
    await waitForDatabaseWork();
    const pendingTimerCount = vi.getTimerCount();
    expect(pendingTimerCount).toBeGreaterThanOrEqual(3);

    stopShiftReminderJob();
    const stoppedTimerCount = vi.getTimerCount();
    expect(pendingTimerCount - stoppedTimerCount).toBe(2);

    startShiftReminderJob();
    await waitForDatabaseWork();
    expect(vi.getTimerCount() - stoppedTimerCount).toBe(2);
    stopShiftReminderJob();

    vi.setSystemTime(new Date(now.getTime() + 24 * 60 * 60 * 1000 + 30_000));
    startShiftReminderJob();
    await waitForDatabaseWork();
    expect(vi.getTimerCount() - stoppedTimerCount).toBe(1);
  });

  it('retries an audit failure within the due window without duplicate audit records', async () => {
    const dueAt = new Date('2040-06-01T00:00:00.000Z');
    const occurrence = await createOccurrence({
      startAt: new Date(dueAt.getTime() + 24 * 60 * 60 * 1000),
    });
    const auditFailure = vi.spyOn(auditQueries, 'logAuditEvent')
      .mockRejectedValueOnce(new Error('temporary audit failure'));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(dueAt.getTime() - 500));
    startShiftReminderJob();
    await waitForDatabaseWork();
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(3);

    await vi.advanceTimersByTimeAsync(500);
    await waitForDatabaseWork();
    expect(auditFailure).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(5_000);
    await waitForDatabaseWork();
    expect(auditFailure).toHaveBeenCalledTimes(2);
    const createdNotifications = await db.select().from(notifications).where(and(
      eq(notifications.recipientId, occurrence.recipientId),
      eq(notifications.relatedShiftId, occurrence.shiftId)
    ));
    expect(createdNotifications).toHaveLength(1);

    const entries = await db.select().from(auditLogs).where(eq(
      auditLogs.entityId,
      createdNotifications[0].id
    ));
    expect(entries).toHaveLength(1);
    expect(entries[0].actorType).toBe('system');
  });

  it('does not send when the scheduler dispatch is beyond its bounded lateness window', async () => {
    const startAt = new Date('2040-07-01T12:00:00.000Z');
    const occurrence: ShiftReminderOccurrence = {
      assignmentId: crypto.randomUUID(),
      shiftId: crypto.randomUUID(),
      recipientId: crypto.randomUUID(),
      startAt,
    };
    const dueAt = startAt.getTime() - 24 * 60 * 60 * 1000;

    await expect(sendShiftReminders(
      [occurrence],
      new Date(dueAt + 60_001)
    )).resolves.toEqual({ sent: 0, errors: 0 });
  });

  it('revalidates cancellation and a changed shift start before sending', async () => {
    const now = new Date('2040-03-01T00:00:00.000Z');
    const cancelledAssignment = await createOccurrence({
      startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000),
    });
    await db.update(shiftAssignments)
      .set({ status: 'cancelled' })
      .where(eq(shiftAssignments.id, cancelledAssignment.assignmentId));
    expect(await runAtDueTime(cancelledAssignment)).toMatchObject({ sent: 0, errors: 0 });

    const cancelledShift = await createOccurrence({
      startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000),
      shiftStatus: 'cancelled',
    });
    expect(await runAtDueTime(cancelledShift)).toMatchObject({ sent: 0, errors: 0 });

    const rescheduled = await createOccurrence({
      startAt: new Date(now.getTime() + 30 * 60 * 60 * 1000),
    });
    const newStartAt = new Date(now.getTime() + 36 * 60 * 60 * 1000);
    await db.update(shifts).set({ startAt: newStartAt }).where(eq(shifts.id, rescheduled.shiftId));
    expect(await runAtDueTime(rescheduled)).toMatchObject({ sent: 0, errors: 0 });

    const updatedOccurrences = await getUpcomingShiftReminderOccurrences(now);
    const updatedOccurrence = updatedOccurrences.find(({ assignmentId }) => assignmentId === rescheduled.assignmentId);
    expect(updatedOccurrence?.startAt.toISOString()).toBe(newStartAt.toISOString());
    expect(updatedOccurrence && await runAtDueTime(updatedOccurrence)).toMatchObject({
      sent: 1,
      errors: 0,
    });
  });

  it('rolls back the notification when its system audit fails and succeeds on retry', async () => {
    const occurrence = await createOccurrence({
      startAt: new Date('2040-04-01T12:00:00.000Z'),
    });
    const auditFailure = vi.spyOn(auditQueries, 'logAuditEvent')
      .mockRejectedValue(new Error('audit unavailable'));

    const failedAttempt = await runAtDueTime(occurrence);
    expect(failedAttempt).toMatchObject({ sent: 0, errors: 1 });
    expect(await db.select().from(notifications).where(eq(
      notifications.relatedShiftId,
      occurrence.shiftId
    ))).toHaveLength(0);

    auditFailure.mockRestore();
    expect(await runAtDueTime(occurrence)).toMatchObject({ sent: 1, errors: 0 });
    expect(await db.select().from(notifications).where(eq(
      notifications.relatedShiftId,
      occurrence.shiftId
    ))).toHaveLength(1);
  });
});
