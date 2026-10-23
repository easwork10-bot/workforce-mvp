import 'server-only';

import { and, eq, gt, inArray, lte, ne } from 'drizzle-orm';
import { db } from '@/backend/db';
import { shifts, shiftAssignments } from '@/backend/db/schema';
import { logAuditEvent } from '@/backend/db/queries/audit';
import { createNotificationIdempotent } from '@/backend/db/queries/notifications';

const REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
const SCHEDULE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
const REFRESH_INTERVAL_MS = 60 * 1000;
const MAX_DUE_LATENESS_MS = REFRESH_INTERVAL_MS;
const RETRY_INTERVAL_MS = 5 * 1000;

export type ShiftReminderOccurrence = {
  assignmentId: string;
  shiftId: string;
  recipientId: string;
  startAt: Date;
};

type ScheduledOccurrence = {
  occurrence: ShiftReminderOccurrence;
  dueAt: number;
  timer?: ReturnType<typeof setTimeout>;
  inFlight: boolean;
};

const scheduledOccurrences = new Map<string, ScheduledOccurrence>();
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let refreshInProgress: Promise<void> | undefined;
let jobRunning = false;

function getOccurrenceKey(occurrence: ShiftReminderOccurrence): string {
  return `${occurrence.assignmentId}:${occurrence.startAt.toISOString()}`;
}

export async function getUpcomingShiftReminderOccurrences(
  now: Date = new Date()
): Promise<ShiftReminderOccurrence[]> {
  const earliestStart = new Date(now.getTime() + REMINDER_LEAD_MS);
  const latestStart = new Date(earliestStart.getTime() + SCHEDULE_LOOKAHEAD_MS);

  const rows = await db
    .select({
      assignmentId: shiftAssignments.id,
      shiftId: shifts.id,
      recipientId: shiftAssignments.employeeId,
      startAt: shifts.startAt,
    })
    .from(shiftAssignments)
    .innerJoin(shifts, eq(shiftAssignments.shiftId, shifts.id))
    .where(and(
      inArray(shiftAssignments.status, ['assigned', 'confirmed']),
      ne(shifts.status, 'cancelled'),
      gt(shifts.startAt, earliestStart),
      lte(shifts.startAt, latestStart)
    ));

  return rows;
}

async function sendShiftReminder(
  occurrence: ShiftReminderOccurrence
): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [shift] = await tx
      .select()
      .from(shifts)
      .where(eq(shifts.id, occurrence.shiftId))
      .for('update')
      .limit(1);
    if (!shift || shift.status === 'cancelled' || shift.startAt.getTime() !== occurrence.startAt.getTime()) {
      return false;
    }

    const [assignment] = await tx
      .select()
      .from(shiftAssignments)
      .where(and(
        eq(shiftAssignments.id, occurrence.assignmentId),
        eq(shiftAssignments.shiftId, occurrence.shiftId)
      ))
      .for('update')
      .limit(1);
    if (
      !assignment ||
      assignment.employeeId !== occurrence.recipientId ||
      !['assigned', 'confirmed'].includes(assignment.status)
    ) {
      return false;
    }

    const idempotencyKey = `shift-reminder:check-in:v1:${assignment.id}:${shift.startAt.toISOString()}`;
    const result = await createNotificationIdempotent({
      recipientId: assignment.employeeId,
      type: 'check_in_reminder',
      title: 'Shift starts in 24 hours',
      message: 'Your assigned shift is scheduled to start in 24 hours.',
      relatedShiftId: shift.id,
      idempotencyKey,
    }, tx);

    if (result.replayed) return false;

    await logAuditEvent({
      actorId: null,
      actorType: 'system',
      action: 'INSERT',
      entityType: 'notifications',
      entityId: result.notification.id,
      oldValues: null,
      newValues: {
        type: result.notification.type,
        relatedShiftId: shift.id,
        assignmentId: assignment.id,
      },
      ipAddress: null,
      userAgent: null,
    }, tx);

    return true;
  });
}

export async function sendShiftReminders(
  occurrences: ShiftReminderOccurrence[],
  now: Date = new Date()
): Promise<{ sent: number; errors: number }> {
  let sent = 0;
  let errors = 0;

  for (const occurrence of occurrences) {
    const lateness = now.getTime() - (occurrence.startAt.getTime() - REMINDER_LEAD_MS);
    if (lateness < 0 || lateness > MAX_DUE_LATENESS_MS) continue;

    try {
      if (await sendShiftReminder(occurrence)) sent += 1;
    } catch (error) {
      errors += 1;
      console.error('[ShiftReminders] Failed to create reminder', {
        assignmentId: occurrence.assignmentId,
        shiftId: occurrence.shiftId,
        error,
      });
    }
  }

  return { sent, errors };
}

function scheduleReminderAttempt(key: string, scheduled: ScheduledOccurrence, delay: number): void {
  if (scheduled.timer) clearTimeout(scheduled.timer);
  scheduled.timer = setTimeout(() => {
    scheduled.timer = undefined;
    void runScheduledOccurrence(key, scheduled);
  }, Math.max(0, delay));
}

async function runScheduledOccurrence(
  key: string,
  scheduled: ScheduledOccurrence
): Promise<void> {
  if (!jobRunning || scheduledOccurrences.get(key) !== scheduled || scheduled.inFlight) return;

  const now = new Date();
  const lateness = now.getTime() - scheduled.dueAt;
  if (lateness > MAX_DUE_LATENESS_MS) {
    scheduledOccurrences.delete(key);
    return;
  }

  scheduled.inFlight = true;
  const result = await sendShiftReminders([scheduled.occurrence], now);
  scheduled.inFlight = false;

  if (!jobRunning || scheduledOccurrences.get(key) !== scheduled) return;
  const remainingLateness = scheduled.dueAt + MAX_DUE_LATENESS_MS - Date.now();
  if (result.errors > 0 && remainingLateness > 0) {
    scheduleReminderAttempt(key, scheduled, Math.min(RETRY_INTERVAL_MS, remainingLateness));
  } else {
    scheduledOccurrences.delete(key);
  }
}

async function refreshScheduledOccurrences(): Promise<void> {
  if (refreshInProgress) return refreshInProgress;

  refreshInProgress = (async () => {
    const now = new Date();
    const occurrences = await getUpcomingShiftReminderOccurrences(now);
    if (!jobRunning) return;
    const nextKeys = new Set(occurrences.map(getOccurrenceKey));

    for (const [key, scheduled] of scheduledOccurrences) {
      if (!nextKeys.has(key)) {
        const dueLateness = now.getTime() - scheduled.dueAt;
        if (dueLateness >= 0 && dueLateness <= MAX_DUE_LATENESS_MS) continue;
        if (scheduled.timer) clearTimeout(scheduled.timer);
        scheduledOccurrences.delete(key);
      }
    }

    for (const occurrence of occurrences) {
      const key = getOccurrenceKey(occurrence);
      if (scheduledOccurrences.has(key)) continue;

      const dueAt = occurrence.startAt.getTime() - REMINDER_LEAD_MS;
      const delay = dueAt - now.getTime();
      if (delay <= 0) continue;

      const scheduled: ScheduledOccurrence = { occurrence, dueAt, inFlight: false };
      scheduledOccurrences.set(key, scheduled);
      scheduleReminderAttempt(key, scheduled, delay);
    }
  })().catch((error: unknown) => {
    console.error('[ShiftReminders] Failed to refresh scheduled occurrences', error);
  }).finally(() => {
    refreshInProgress = undefined;
  });

  return refreshInProgress;
}

export function startShiftReminderJob(): void {
  if (jobRunning) return;

  jobRunning = true;
  void refreshScheduledOccurrences();
  refreshTimer = setInterval(() => {
    void refreshScheduledOccurrences();
  }, REFRESH_INTERVAL_MS);
}

export function stopShiftReminderJob(): void {
  jobRunning = false;
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = undefined;
  }

  for (const scheduled of scheduledOccurrences.values()) {
    if (scheduled.timer) clearTimeout(scheduled.timer);
  }
  scheduledOccurrences.clear();
}
