import { dateKeyInTimeZone } from '@/shared/worksite-time';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';

export type ScheduleView = 'week' | 'month';

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function scheduleRange(anchor: string, view: ScheduleView) {
  const start = utcDate(anchor);
  const end = utcDate(anchor);
  if (view === 'week') {
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
    end.setTime(start.getTime());
    end.setUTCDate(end.getUTCDate() + 6);
  } else {
    start.setUTCDate(1);
    end.setUTCMonth(end.getUTCMonth() + 1, 0);
  }
  const days: string[] = [];
  for (const day = new Date(start); day <= end; day.setUTCDate(day.getUTCDate() + 1)) {
    days.push(dateKey(day));
  }
  return { from: dateKey(start), to: dateKey(end), days };
}

export function moveScheduleAnchor(anchor: string, view: ScheduleView, direction: -1 | 1): string {
  const date = utcDate(anchor);
  if (view === 'week') {
    date.setUTCDate(date.getUTCDate() + direction * 7);
  } else {
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + direction);
  }
  return dateKey(date);
}

export function groupAssignmentsByDay(days: string[], assignments: EmployeeScheduleItem[]) {
  const groups = days.map(date => ({ date, assignments: [] as EmployeeScheduleItem[] }));
  for (const assignment of assignments) {
    const { startAt, endAt, timeZone } = assignment.shift;
    const first = dateKeyInTimeZone(new Date(startAt), timeZone);
    const last = dateKeyInTimeZone(new Date(Date.parse(endAt) - 1), timeZone);
    for (const group of groups) {
      if (group.date >= first && group.date <= last) group.assignments.push(assignment);
    }
  }
  return groups;
}
