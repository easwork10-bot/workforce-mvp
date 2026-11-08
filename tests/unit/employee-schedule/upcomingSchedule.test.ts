import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchUpcomingSchedule } from '@/frontend/features/employee-schedule/upcomingSchedule';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';

const now = new Date('2027-03-24T12:00:00.000Z');

function assignment(index: number, overrides: Partial<EmployeeScheduleItem> = {}): EmployeeScheduleItem {
  const id = `c2df4e6f-72a7-4e7a-9de1-${String(index + 1).padStart(12, '0')}`;
  return {
    id,
    status: 'assigned',
    shift: {
      id, title: `Shift ${index}`, location: 'Amsterdam', status: 'filled', timeZone: 'Europe/Amsterdam',
      startAt: '2027-03-24T13:00:00.000Z', endAt: '2027-03-24T14:00:00.000Z',
    },
    attendance: null,
    ...overrides,
  };
}

describe('employee dashboard upcoming schedule', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => vi.unstubAllGlobals());

  it('reads every page before producing a sorted count and deduplicates assignments', async () => {
    const history = Array.from({ length: 20 }, (_, index) => assignment(index, { status: 'cancelled' }));
    const later = assignment(20);
    const earlier = assignment(21, {
      status: 'confirmed',
      shift: { ...assignment(21).shift, startAt: '2027-03-24T11:00:00.000Z', endAt: '2027-03-24T13:00:00.000Z' },
    });
    fetchMock.mockResolvedValueOnce(Response.json({
      assignments: history, pagination: { page: 1, limit: 20, total: 23, totalPages: 2 },
    })).mockResolvedValueOnce(Response.json({
      assignments: [later, earlier, later], pagination: { page: 2, limit: 20, total: 23, totalPages: 2 },
    }));
    const signal = new AbortController().signal;
    await expect(fetchUpcomingSchedule(now, signal)).resolves.toEqual([earlier, later]);
    expect(fetchMock).toHaveBeenNthCalledWith(1,
      '/api/employee/schedule?dateFrom=2027-03-24&dateTo=2027-03-28&page=1&limit=20',
      expect.objectContaining({ signal }));
    expect(fetchMock).toHaveBeenNthCalledWith(2,
      '/api/employee/schedule?dateFrom=2027-03-24&dateTo=2027-03-28&page=2&limit=20',
      expect.objectContaining({ signal }));
  });

  it('excludes ended, cancelled, completed and cancelled-shift records', async () => {
    const active = assignment(0);
    const ended = assignment(1, {
      shift: { ...assignment(1).shift, startAt: '2027-03-24T11:00:00.000Z', endAt: now.toISOString() },
    });
    const cancelled = assignment(2, { status: 'cancelled' });
    const completed = assignment(3, { status: 'completed' });
    const cancelledShift = assignment(4, { shift: { ...assignment(4).shift, status: 'cancelled' } });
    const completedShift = assignment(5, { shift: { ...assignment(5).shift, status: 'completed' } });
    fetchMock.mockResolvedValue(Response.json({
      assignments: [active, ended, cancelled, completed, cancelledShift, completedShift],
      pagination: { page: 1, limit: 20, total: 6, totalPages: 1 },
    }));
    await expect(fetchUpcomingSchedule(now)).resolves.toEqual([active]);
  });

  it('does not present a partial count when a later page fails', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({
      assignments: [assignment(0)], pagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
    })).mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
    await expect(fetchUpcomingSchedule(now)).rejects.toMatchObject({ status: 503 });
  });

  it('uses the worksite date rather than the browser or UTC date for the current week', async () => {
    fetchMock.mockResolvedValue(Response.json({
      assignments: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    }));
    await fetchUpcomingSchedule(new Date('2027-03-24T23:30:00.000Z'));
    expect(fetchMock.mock.calls[0][0])
      .toBe('/api/employee/schedule?dateFrom=2027-03-25&dateTo=2027-03-28&page=1&limit=20');
  });
});
