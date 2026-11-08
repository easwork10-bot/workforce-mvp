import { z } from 'zod';
import { isoDateTimeString, uuidLikeString } from '@/shared/validation';

export const applicationStatuses = ['pending', 'accepted', 'rejected', 'cancelled'] as const;
export type ApplicationStatus = typeof applicationStatuses[number];

export const adminApplicationPageSchema = z.object({
  applications: z.array(z.object({
    id: uuidLikeString(),
    shiftId: uuidLikeString(),
    employeeId: uuidLikeString(),
    status: z.enum(applicationStatuses),
    appliedAt: isoDateTimeString(),
    rejectionReason: z.string().nullable(),
    employee: z.object({ fullName: z.string(), email: z.string(), phone: z.string().nullable() }),
    shift: z.object({
      title: z.string(),
      startAt: isoDateTimeString(),
      endAt: isoDateTimeString(),
      location: z.string(),
      status: z.enum(['draft', 'open', 'filled', 'cancelled', 'completed']),
      requiredWorkers: z.number().int().positive(),
      assignedCount: z.number().int().nonnegative(),
    }),
  })).max(100),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type AdminApplicationPage = z.infer<typeof adminApplicationPageSchema>;
export type AdminApplication = AdminApplicationPage['applications'][number];
