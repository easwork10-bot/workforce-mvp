import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchEmployeeSchedule } from '@/frontend/features/employee-schedule/employeeScheduleApi';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
const assignment = {
  id,
  status: 'assigned',
  shift: {
    id, title: 'Real shift', location: 'Amsterdam', status: 'filled', timeZone: 'Europe/Amsterdam',
    startAt: '2027-03-27T22:30:00.000Z', endAt: '2027-03-28T01:00:00.000Z',
  },
  attendance: {
    id, checkInAt: '2027-03-27T22:30:00.000Z', checkOutAt: null, attendanceStatus: 'checked_in',
  },
};
const page = { assignments: [assignment], pagination: { page: 1, limit: 20, total: 1, totalPages: 1 } };

describe('employee schedule browser API', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('requests a date range and page with cookies, no cache, and abort support', async () => {
    const signal = new AbortController().signal;
    fetchMock.mockResolvedValue(Response.json(page));
    await expect(fetchEmployeeSchedule('2027-03-22', '2027-03-28', 1, signal)).resolves.toEqual(page);
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      '/api/employee/schedule?dateFrom=2027-03-22&dateTo=2027-03-28&page=1&limit=20',
      { credentials: 'same-origin', cache: 'no-store', signal, headers: { Accept: 'application/json' } },
    );
  });

  it.each([401, 403, 503, 500])('preserves HTTP %s errors without exposing response bodies', async status => {
    fetchMock.mockResolvedValue(new Response('private error', { status }));
    await expect(fetchEmployeeSchedule('2027-03-22', '2027-03-28', 1))
      .rejects.toMatchObject({ name: 'EmployeeScheduleApiError', status });
  });

  it.each([
    { ...page, assignments: [{ ...assignment, status: 'pending' }] },
    { ...page, assignments: [{ ...assignment, shift: { ...assignment.shift, timeZone: 'invalid/zone' } }] },
    { ...page, assignments: [{ ...assignment, shift: { ...assignment.shift, endAt: assignment.shift.startAt } }] },
    { ...page, assignments: [{ ...assignment, attendance: { ...assignment.attendance, attendanceStatus: 'unknown' } }] },
    { ...page, pagination: { ...page.pagination, totalPages: 0 } },
    { ...page, pagination: { ...page.pagination, page: 2 } },
    { ...page, pagination: { ...page.pagination, limit: 10 } },
    { ...page, assignments: undefined },
  ])('rejects malformed or inconsistent response %j', async body => {
    fetchMock.mockResolvedValue(Response.json(body));
    await expect(fetchEmployeeSchedule('2027-03-22', '2027-03-28', 1))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('rejects invalid JSON and preserves network and abort failures', async () => {
    fetchMock.mockResolvedValueOnce(new Response('not JSON'));
    await expect(fetchEmployeeSchedule('2027-03-22', '2027-03-28', 1))
      .rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
    for (const failure of [new TypeError('Network unavailable'), new DOMException('Cancelled', 'AbortError')]) {
      fetchMock.mockRejectedValueOnce(failure);
      await expect(fetchEmployeeSchedule('2027-03-22', '2027-03-28', 1)).rejects.toBe(failure);
    }
  });
});
