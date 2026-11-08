import { z } from 'zod';
import { assignmentStatuses } from '@/shared/admin-assignments';
import { isoDateTimeString, uuidLikeString } from '@/shared/validation';

const attendanceStatuses = ['checked_in', 'checked_out', 'late', 'absent', 'missed_checkout'] as const;
const shiftStatuses = ['draft', 'open', 'filled', 'cancelled', 'completed'] as const;

const timeZoneSchema = z.string().min(1).refine(value => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}, 'Invalid worksite time zone');

const scheduleShiftSchema = z.object({
  id: uuidLikeString(),
  title: z.string(),
  location: z.string(),
  startAt: isoDateTimeString(),
  endAt: isoDateTimeString(),
  status: z.enum(shiftStatuses),
  timeZone: timeZoneSchema,
}).refine(shift => Date.parse(shift.endAt) > Date.parse(shift.startAt), {
  message: 'Shift end must be after its start',
  path: ['endAt'],
});

export const employeeSchedulePageSchema = z.object({
  assignments: z.array(z.object({
    id: uuidLikeString(),
    status: z.enum(assignmentStatuses),
    shift: scheduleShiftSchema,
    attendance: z.object({
      id: uuidLikeString(),
      checkInAt: isoDateTimeString().nullable(),
      checkOutAt: isoDateTimeString().nullable(),
      attendanceStatus: z.enum(attendanceStatuses),
    }).nullable(),
  })).max(100),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
}).refine(({ assignments, pagination }) =>
  assignments.length <= pagination.limit
  && pagination.totalPages === Math.ceil(pagination.total / pagination.limit), {
  message: 'Inconsistent schedule pagination',
  path: ['pagination'],
});

export type EmployeeSchedulePage = z.infer<typeof employeeSchedulePageSchema>;
export type EmployeeScheduleItem = EmployeeSchedulePage['assignments'][number];
