import { startShiftReminderJob, stopShiftReminderJob } from '@/lib/jobs/shiftReminders';

let shutdownHandlersRegistered = false;

export function register(): void {
  if (
    process.env.NODE_ENV !== 'production' ||
    process.env.SHIFT_REMINDER_JOB_ENABLED !== 'true' ||
    process.env.NEXT_PHASE === 'phase-production-build'
  ) {
    return;
  }

  startShiftReminderJob();
  if (shutdownHandlersRegistered) return;

  process.once('SIGTERM', stopShiftReminderJob);
  process.once('SIGINT', stopShiftReminderJob);
  shutdownHandlersRegistered = true;
}
