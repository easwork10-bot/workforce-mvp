import { startShiftReminderJob, stopShiftReminderJob } from '@/lib/jobs/shiftReminders';
import { assertJwtKeyConfiguration } from '@/lib/auth/tokens';
import { assertCsrfSecretConfiguration } from '@/lib/middleware/csrfSecret';

let shutdownHandlersRegistered = false;

export async function register(): Promise<void> {
  if (process.env.NEXT_PHASE === 'phase-production-build') return;

  assertCsrfSecretConfiguration();
  await assertJwtKeyConfiguration();
  if (process.env.NODE_ENV !== 'production' || process.env.SHIFT_REMINDER_JOB_ENABLED !== 'true') return;

  startShiftReminderJob();
  if (shutdownHandlersRegistered) return;

  process.once('SIGTERM', stopShiftReminderJob);
  process.once('SIGINT', stopShiftReminderJob);
  shutdownHandlersRegistered = true;
}
