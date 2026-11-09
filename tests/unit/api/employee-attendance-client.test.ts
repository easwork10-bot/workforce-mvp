import { afterEach, describe, expect, it, vi } from 'vitest';
import { attendanceActions, recordAttendance } from '@/frontend/features/employee-attendance/employeeAttendanceApi';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';
function item(status: EmployeeScheduleItem['status'], attendanceStatus?: NonNullable<EmployeeScheduleItem['attendance']>['attendanceStatus']) {
  return { status, attendance: attendanceStatus ? { attendanceStatus } : null } as EmployeeScheduleItem;
}
afterEach(() => vi.unstubAllGlobals());

describe('attendance transitions and requests', () => {
  it.each(['assigned', 'confirmed'] as const)('allows %s check-in and another session after checkout', status => {
    expect(attendanceActions(item(status))).toEqual({ checkIn: true, checkOut: false });
    expect(attendanceActions(item(status, 'checked_out'))).toEqual({ checkIn: true, checkOut: false });
  });
  it.each(['cancelled', 'completed'] as const)('blocks %s check-in but permits active checkout', status => {
    expect(attendanceActions(item(status))).toEqual({ checkIn: false, checkOut: false });
    expect(attendanceActions(item(status, 'checked_in'))).toEqual({ checkIn: false, checkOut: true });
  });
  it.each(['checked_in', 'late'] as const)('prevents duplicate check-in for %s', status => {
    expect(attendanceActions(item('confirmed', status))).toEqual({ checkIn: false, checkOut: true });
  });
  it.each(['check-in', 'check-out'] as const)('posts assignment ID and CSRF token for %s without invented coordinates', async action => {
    const fetchMock = vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'token' })).mockResolvedValueOnce(Response.json({ record: {} }));
    vi.stubGlobal('fetch', fetchMock);
    await recordAttendance(id, action);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `/api/employee/attendance/${action}`, {
      method: 'POST', credentials: 'same-origin', headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': 'token' },
      body: JSON.stringify({ shiftAssignmentId: id }),
    });
  });
  it('never mutates without a valid CSRF response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({}));
    vi.stubGlobal('fetch', fetchMock);
    await expect(recordAttendance(id, 'check-in')).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([400, 401, 403, 500])('preserves HTTP %s failure for translated feedback', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ csrfToken: 'token' })).mockResolvedValueOnce(new Response('private error', { status })));
    await expect(recordAttendance(id, 'check-out')).rejects.toMatchObject({ status });
  });
});
