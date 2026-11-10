import { beforeEach, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));
vi.mock('pg', () => ({
  Pool: class {
    connect = probe.connect;
  },
}));
vi.mock('drizzle-orm/node-postgres', () => ({ drizzle: vi.fn(() => ({})) }));
vi.mock('@/backend/db/schema', () => ({}));
import { checkDatabaseConnection } from '@/backend/db';

beforeEach(() => {
  probe.query.mockReset().mockResolvedValue({});
  probe.release.mockReset();
  probe.connect.mockReset().mockResolvedValue({ query: probe.query, release: probe.release });
});

it('bounds the query and releases the checked-out connection on success', async () => {
  expect(await checkDatabaseConnection()).toBe(true);
  expect(probe.query).toHaveBeenCalledWith({ text: 'SELECT 1', query_timeout: 3000 });
  expect(probe.release).toHaveBeenCalledOnce();
});

it('releases the connection and logs failure when the probe query fails', async () => {
  const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  probe.query.mockRejectedValue(new Error('probe failed'));
  expect(await checkDatabaseConnection()).toBe(false);
  expect(probe.release).toHaveBeenCalledOnce();
  expect(log).toHaveBeenCalledOnce();
  log.mockRestore();
});
