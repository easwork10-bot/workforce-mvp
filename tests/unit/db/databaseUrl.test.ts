import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  Pool: vi.fn(),
  drizzle: vi.fn(),
}));

vi.mock('server-only', () => ({}));
vi.mock('pg', () => ({ Pool: mocks.Pool }));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: mocks.drizzle }));

describe('runtime database configuration', () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mocks.Pool.mockClear();
    mocks.drizzle.mockClear();
  });

  it('rejects a missing DATABASE_URL before creating a PostgreSQL pool', async () => {
    vi.stubEnv('DATABASE_URL', '');

    await expect(import('@/backend/db')).rejects.toThrow(
      'DATABASE_URL must be explicitly configured before connecting to PostgreSQL.',
    );
    expect(mocks.Pool).not.toHaveBeenCalled();
  });
});
