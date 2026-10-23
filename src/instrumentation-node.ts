import { startShiftReminderJob, stopShiftReminderJob } from '@/backend/jobs/shiftReminders';
import { assertJwtKeyConfiguration } from '@/backend/auth/tokens';
import { assertCsrfSecretConfiguration } from '@/backend/security/csrfSecret';

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
