import { z } from 'zod';

export const applicationStatuses = ['pending', 'accepted', 'rejected', 'cancelled'] as const;
export type ApplicationStatus = typeof applicationStatuses[number];

export const adminApplicationPageSchema = z.object({
  applications: z.array(z.object({
    id: z.string().uuid(),
    shiftId: z.string().uuid(),
    employeeId: z.string().uuid(),
    status: z.enum(applicationStatuses),
    appliedAt: z.string().datetime(),
    rejectionReason: z.string().nullable(),
    employee: z.object({ fullName: z.string(), email: z.string(), phone: z.string().nullable() }),
    shift: z.object({
      title: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
      location: z.string(),
      status: z.enum(['draft', 'open', 'filled', 'cancelled', 'completed']),
      requiredWorkers: z.number().int().positive(),
      assignedCount: z.number().int().nonnegative(),
    }),
  })),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type AdminApplicationPage = z.infer<typeof adminApplicationPageSchema>;
export type AdminApplication = AdminApplicationPage['applications'][number];
