import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyForEmployeeShift,
  EmployeeShiftApiError,
  fetchEmployeeShifts,
} from '@/frontend/features/employee-shifts/employeeShiftsApi';
import { runOncePerKey } from '@/frontend/features/employee-shifts/runOncePerKey';

const shift = {
  id: 'shift-1',
  title: 'Warehouse support',
  workType: 'Logistics',
  clientOrProject: null,
  location: 'Utrecht',
  startAt: '2026-11-01T08:00:00.000Z',
  endAt: '2026-11-01T16:00:00.000Z',
  requiredWorkers: 3,
  compensationType: 'hourly',
  compensationAmount: '18.50',
  description: null,
  applicationCount: 2,
  assignedCount: 1,
  hasApplied: false,
};

describe('employee shift browser API', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('requests the existing employee shifts endpoint and preserves its pagination contract', async () => {
    const responseBody = {
      shifts: [shift],
      pagination: { page: 2, limit: 12, total: 13, totalPages: 2 },
    };
    fetchMock.mockResolvedValue(Response.json(responseBody));

    const result = await fetchEmployeeShifts(2);

    expect(result).toEqual(responseBody);
    expect(fetchMock).toHaveBeenCalledWith('/api/employee/shifts?page=2&limit=12', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [500, 'server'],
  ] as const)('surfaces a %s response as a %s error', async (status, kind) => {
    fetchMock.mockResolvedValue(Response.json({ error: 'Request rejected' }, { status }));

    await expect(fetchEmployeeShifts(1)).rejects.toMatchObject({ kind, status });
  });

  it('surfaces network failures instead of returning a success-shaped fallback', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network unavailable'));

    await expect(fetchEmployeeShifts(1)).rejects.toMatchObject({ kind: 'network' });
  });

  it('acquires the CSRF token and posts it as the raw header from the existing token endpoint', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ csrfToken: 'raw-csrf-token' }))
      .mockResolvedValueOnce(Response.json({
        message: 'Sollicitatie succesvol ingediend',
        applicationId: 'application-1',
      }));

    await expect(applyForEmployeeShift('shift/one')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/auth/csrf', expect.objectContaining({
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/employee/shifts/shift%2Fone/apply',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          Accept: 'application/json',
          'x-csrf-token': 'raw-csrf-token',
        },
      })
    );
  });

  it('reports application rejection and invalid CSRF responses as failures', async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json({ csrfToken: 'raw-csrf-token' }))
      .mockResolvedValueOnce(Response.json({ error: 'Insufficient permissions' }, { status: 403 }));

    await expect(applyForEmployeeShift('shift-1')).rejects.toMatchObject({
      kind: 'forbidden',
      status: 403,
    });

    fetchMock.mockReset();
    fetchMock.mockResolvedValue(Response.json({ error: 'CSRF unavailable' }, { status: 500 }));
    await expect(applyForEmployeeShift('shift-1')).rejects.toMatchObject({
      kind: 'csrf',
      status: 500,
    });
  });
});

describe('runOncePerKey', () => {
  it('prevents concurrent duplicate submissions and allows a later retry', async () => {
    const pending = new Set<string>();
    let finishFirst: (value: string) => void = () => {};
    const operation = vi.fn(() => new Promise<string>((resolve) => {
      finishFirst = resolve;
    }));

    const first = runOncePerKey(pending, 'shift-1', operation);
    const duplicate = await runOncePerKey(pending, 'shift-1', operation);

    expect(duplicate).toEqual({ started: false });
    expect(operation).toHaveBeenCalledOnce();
    expect(pending.has('shift-1')).toBe(true);

    finishFirst('applied');
    await expect(first).resolves.toEqual({ started: true, value: 'applied' });
    expect(pending.has('shift-1')).toBe(false);
    await expect(runOncePerKey(pending, 'shift-1', async () => 'retried')).resolves.toEqual({
      started: true,
      value: 'retried',
    });
  });

  it('releases the submission key after a rejected operation', async () => {
    const pending = new Set<string>();
    await expect(
      runOncePerKey(pending, 'shift-1', async () => {
        throw new EmployeeShiftApiError('server', 'Application failed');
      })
    ).rejects.toThrow('Application failed');
    expect(pending.has('shift-1')).toBe(false);
  });
});
