import { z } from 'zod';
import { isoDateTimeString, uuidLikeString } from '@/shared/validation';

export const employeeDashboardSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  timeZone: z.literal('Europe/Amsterdam'),
  pendingApplications: z.number().int().nonnegative(),
  acceptedThisMonth: z.number().int().nonnegative(),
  workedHoursThisMonth: z.number().finite().nonnegative(),
  recentApplications: z.array(z.object({
    id: uuidLikeString(),
    status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']),
    appliedAt: isoDateTimeString(),
    shift: z.object({ title: z.string(), startAt: isoDateTimeString(), endAt: isoDateTimeString(), location: z.string() }),
  })).max(3),
});

export type EmployeeDashboardSummary = z.infer<typeof employeeDashboardSchema>;
