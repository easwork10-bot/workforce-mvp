import { fetchEmployeeSchedule } from './employeeScheduleApi';
import { scheduleRange } from './scheduleCalendar';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';
import { dateKeyInTimeZone, DEFAULT_WORKSITE_TIME_ZONE } from '@/shared/worksite-time';

export async function fetchUpcomingSchedule(now: Date, signal?: AbortSignal): Promise<EmployeeScheduleItem[]> {
  const dateFrom = dateKeyInTimeZone(now, DEFAULT_WORKSITE_TIME_ZONE);
  const dateTo = scheduleRange(dateFrom, 'week').to;
  const records = new Map<string, EmployeeScheduleItem>();
  let page = 1;
  let totalPages: number;
  do {
    const result = await fetchEmployeeSchedule(dateFrom, dateTo, page, signal);
    for (const assignment of result.assignments) records.set(assignment.id, assignment);
    totalPages = result.pagination.totalPages;
    page += 1;
  } while (page <= totalPages);

  return [...records.values()].filter(assignment =>
    (assignment.status === 'assigned' || assignment.status === 'confirmed')
    && (assignment.shift.status === 'open' || assignment.shift.status === 'filled')
    && Date.parse(assignment.shift.endAt) > now.getTime(),
  ).sort((left, right) =>
    Date.parse(left.shift.startAt) - Date.parse(right.shift.startAt)
    || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
  );
}
