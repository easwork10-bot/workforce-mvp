import { describe, expect, it } from 'vitest';
import {
  groupAssignmentsByDay, moveScheduleAnchor, scheduleRange,
} from '@/frontend/features/employee-schedule/scheduleCalendar';
import { dateKeyInTimeZone } from '@/shared/worksite-time';
import type { EmployeeScheduleItem } from '@/shared/employee-schedule';

const id = 'c2df4e6f-72a7-4e7a-9de1-27fe78d442a1';

function assignment(startAt: string, endAt: string, timeZone = 'Europe/Amsterdam'): EmployeeScheduleItem {
  return {
    id,
    status: 'confirmed',
    shift: { id, title: 'Overnight shift', location: 'Amsterdam', startAt, endAt, timeZone, status: 'filled' },
    attendance: null,
  };
}

describe('employee schedule calendar', () => {
  it('uses Monday-to-Sunday date-only ranges across a DST transition', () => {
    expect(scheduleRange('2027-03-28', 'week')).toEqual({
      from: '2027-03-22',
      to: '2027-03-28',
      days: ['2027-03-22', '2027-03-23', '2027-03-24', '2027-03-25', '2027-03-26', '2027-03-27', '2027-03-28'],
    });
    expect(moveScheduleAnchor('2027-03-28', 'week', 1)).toBe('2027-04-04');
    expect(moveScheduleAnchor('2027-03-28', 'week', -1)).toBe('2027-03-21');
  });

  it('navigates entire months without overflowing at month ends or leap days', () => {
    expect(scheduleRange('2028-02-29', 'month')).toMatchObject({ from: '2028-02-01', to: '2028-02-29' });
    expect(scheduleRange('2027-02-28', 'month').days).toHaveLength(28);
    expect(moveScheduleAnchor('2027-01-31', 'month', 1)).toBe('2027-02-01');
    expect(moveScheduleAnchor('2027-01-31', 'month', -1)).toBe('2026-12-01');
  });

  it('uses the worksite time zone, not the browser language or local time zone', () => {
    const instant = new Date('2027-03-27T21:30:00.000Z');
    expect(dateKeyInTimeZone(instant, 'Europe/Amsterdam')).toBe('2027-03-27');
    expect(dateKeyInTimeZone(instant, 'Asia/Riyadh')).toBe('2027-03-28');
  });

  it('groups an overnight shift on each overlapping worksite date including DST days', () => {
    const overnight = assignment('2027-03-27T22:30:00.000Z', '2027-03-27T23:30:00.000Z');
    expect(groupAssignmentsByDay(['2027-03-27', '2027-03-28', '2027-03-29'], [overnight]))
      .toEqual([
        { date: '2027-03-27', assignments: [overnight] },
        { date: '2027-03-28', assignments: [overnight] },
        { date: '2027-03-29', assignments: [] },
      ]);
    const autumn = assignment('2027-10-30T21:30:00.000Z', '2027-10-30T22:30:00.000Z');
    expect(groupAssignmentsByDay(['2027-10-30', '2027-10-31'], [autumn]).map(day => day.assignments.length))
      .toEqual([1, 1]);
  });

  it('does not place a shift on a date where it ends exactly at midnight', () => {
    const untilMidnight = assignment('2027-03-27T21:00:00.000Z', '2027-03-27T23:00:00.000Z');
    expect(groupAssignmentsByDay(['2027-03-27', '2027-03-28'], [untilMidnight]).map(day => day.assignments.length))
      .toEqual([1, 0]);
  });

  it('uses each shift’s supplied time zone when grouping its dates', () => {
    const riyadh = assignment('2027-03-27T21:30:00.000Z', '2027-03-27T22:30:00.000Z', 'Asia/Riyadh');
    expect(groupAssignmentsByDay(['2027-03-27', '2027-03-28'], [riyadh]).map(day => day.assignments.length))
      .toEqual([0, 1]);
  });
});
