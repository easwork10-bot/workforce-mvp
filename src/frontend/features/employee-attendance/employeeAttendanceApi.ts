import { z } from 'zod';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';

export class AttendanceApiError extends Error {
  constructor(readonly status?: number) { super('Attendance request failed'); }
}

export function attendanceActions(item: EmployeeScheduleItem) {
  const active = item.attendance?.attendanceStatus === 'checked_in' || item.attendance?.attendanceStatus === 'late';
  // Existing rules allow a new session after checkout, with no shift-time window.
  // Active attendance can be checked out even if the assignment status changes.
  return { checkIn: !active && ['assigned', 'confirmed'].includes(item.status), checkOut: active };
}

export async function recordAttendance(id: string, action: 'check-in' | 'check-out'): Promise<void> {
  const tokenResponse = await fetch('/api/auth/csrf', {
    credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' },
  });
  if (!tokenResponse.ok) throw new AttendanceApiError(tokenResponse.status);
  const token = z.object({ csrfToken: z.string().min(1) }).parse(await tokenResponse.json());
  const response = await fetch(`/api/employee/attendance/${action}`, {
    method: 'POST', credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'x-csrf-token': token.csrfToken },
    body: JSON.stringify({ shiftAssignmentId: id }),
  });
  if (!response.ok) throw new AttendanceApiError(response.status);
}
