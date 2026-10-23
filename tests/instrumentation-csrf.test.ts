import { afterEach, describe, expect, it, vi } from 'vitest';

const scheduler = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
}));
const jwtConfiguration = vi.hoisted(() => ({
  assert: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/jobs/shiftReminders', () => ({
  startShiftReminderJob: scheduler.start,
  stopShiftReminderJob: scheduler.stop,
}));
vi.mock('@/lib/auth/tokens', () => ({
  assertJwtKeyConfiguration: jwtConfiguration.assert,
}));

import { register } from '@/instrumentation-node';

const originalEnvironment = {
  csrfSecret: process.env.CSRF_SECRET,
  nodeEnv: process.env.NODE_ENV,
  nextPhase: process.env.NEXT_PHASE,
  reminderEnabled: process.env.SHIFT_REMINDER_JOB_ENABLED,
};

describe('Node instrumentation security configuration validation', () => {
  afterEach(() => {
    if (originalEnvironment.csrfSecret === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = originalEnvironment.csrfSecret;
    if (originalEnvironment.nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment.nodeEnv;
    if (originalEnvironment.nextPhase === undefined) delete process.env.NEXT_PHASE;
    else process.env.NEXT_PHASE = originalEnvironment.nextPhase;
    if (originalEnvironment.reminderEnabled === undefined) delete process.env.SHIFT_REMINDER_JOB_ENABLED;
    else process.env.SHIFT_REMINDER_JOB_ENABLED = originalEnvironment.reminderEnabled;
    scheduler.start.mockClear();
    scheduler.stop.mockClear();
    jwtConfiguration.assert.mockClear();
  });

  it.each([
    ['missing', undefined],
    ['weak', 'weak-production-secret'],
  ])('refuses production startup with a %s CSRF secret', async (_label, secret) => {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;
    delete process.env.SHIFT_REMINDER_JOB_ENABLED;
    if (secret === undefined) delete process.env.CSRF_SECRET;
    else process.env.CSRF_SECRET = secret;

    await expect(register()).rejects.toThrow('CSRF_SECRET');
    expect(jwtConfiguration.assert).not.toHaveBeenCalled();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('validates both key configurations when the reminder job is disabled', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.NEXT_PHASE;
    delete process.env.SHIFT_REMINDER_JOB_ENABLED;
    process.env.CSRF_SECRET = 'valid-production-secret-material-at-least-thirty-two-bytes';

    await expect(register()).resolves.toBeUndefined();
    expect(jwtConfiguration.assert).toHaveBeenCalledOnce();
    expect(scheduler.start).not.toHaveBeenCalled();
  });

  it('does not validate runtime secrets during the production build phase', async () => {
    process.env.NODE_ENV = 'production';
    process.env.NEXT_PHASE = 'phase-production-build';
    delete process.env.CSRF_SECRET;
    delete process.env.SHIFT_REMINDER_JOB_ENABLED;

    await expect(register()).resolves.toBeUndefined();
    expect(jwtConfiguration.assert).not.toHaveBeenCalled();
  });
});
