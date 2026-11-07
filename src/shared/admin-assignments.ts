import { z } from 'zod';

export const assignmentStatuses = ['assigned', 'confirmed', 'cancelled', 'completed'] as const;
export type AssignmentStatus = typeof assignmentStatuses[number];

export const adminAssignmentPageSchema = z.object({
  assignments: z.array(z.object({
    id: z.string().uuid(),
    shiftId: z.string().uuid(),
    employeeId: z.string().uuid(),
    applicationId: z.string().uuid().nullable(),
    status: z.enum(assignmentStatuses),
    assignedBy: z.string().uuid(),
    assignedAt: z.string().datetime(),
    confirmedAt: z.string().datetime().nullable(),
    employee: z.object({ id: z.string().uuid(), fullName: z.string() }),
    shift: z.object({
      id: z.string().uuid(),
      title: z.string(),
      location: z.string(),
      startAt: z.string().datetime(),
      endAt: z.string().datetime(),
    }),
  })),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type AdminAssignmentPage = z.infer<typeof adminAssignmentPageSchema>;
export type AdminAssignment = AdminAssignmentPage['assignments'][number];
