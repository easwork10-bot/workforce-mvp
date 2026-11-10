import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probes = vi.hoisted(() => ({
  database: vi.fn(),
  redis: vi.fn(),
  ping: vi.fn(),
}));
vi.mock('@/backend/db', () => ({ checkDatabaseConnection: probes.database }));
vi.mock('@/backend/auth/session', () => ({ getRedis: probes.redis }));

import { GET } from '@/app/api/health/route';
import { GET as live } from '@/app/api/live/route';

beforeEach(() => {
  probes.database.mockReset().mockResolvedValue(true);
  probes.ping.mockReset().mockResolvedValue('PONG');
  probes.redis.mockReset().mockResolvedValue({ ping: probes.ping });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('runtime health', () => {
  it('requires an actual Redis PONG and PostgreSQL query and forbids caching', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ db: true, redis: true, status: 'ok' });
    expect(probes.ping).toHaveBeenCalledOnce();
    expect(probes.database).toHaveBeenCalledOnce();
  });
  it.each(['WRONG', null])('does not accept an invalid Redis reply: %s', async reply => {
    probes.ping.mockResolvedValue(reply);
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ db: true, redis: false });
    expect(console.error).toHaveBeenCalled();
  });
  it('reports PostgreSQL failure as unready', async () => {
    probes.database.mockResolvedValue(false);
    expect((await GET()).status).toBe(503);
  });
  it('bounds a connected but unresponsive Redis command', async () => {
    vi.useFakeTimers();
    probes.ping.mockImplementation(() => new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(3000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ redis: false });
    expect(console.error).toHaveBeenCalled();
  });
  it('reports connection failure without leaking its details', async () => {
    probes.redis.mockRejectedValue(new Error('synthetic-sensitive-connection-detail'));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('synthetic-sensitive-connection-detail');
  });
  it('keeps liveness independent of dependency outages', async () => {
    const response = live();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(probes.database).not.toHaveBeenCalled();
    expect(probes.redis).not.toHaveBeenCalled();
  });
});
