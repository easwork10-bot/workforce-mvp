import { z } from 'zod';
import { isoDateTimeString, uuidLikeString } from '@/shared/validation';

export const assignmentStatuses = ['assigned', 'confirmed', 'cancelled', 'completed'] as const;
export type AssignmentStatus = typeof assignmentStatuses[number];

export const adminAssignmentPageSchema = z.object({
  assignments: z.array(z.object({
    id: uuidLikeString(),
    shiftId: uuidLikeString(),
    employeeId: uuidLikeString(),
    applicationId: uuidLikeString().nullable(),
    status: z.enum(assignmentStatuses),
    assignedBy: uuidLikeString(),
    assignedAt: isoDateTimeString(),
    confirmedAt: isoDateTimeString().nullable(),
    employee: z.object({ id: uuidLikeString(), fullName: z.string() }),
    shift: z.object({
      id: uuidLikeString(),
      title: z.string(),
      location: z.string(),
      startAt: isoDateTimeString(),
      endAt: isoDateTimeString(),
    }),
  })).max(100),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive().max(100),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export type AdminAssignmentPage = z.infer<typeof adminAssignmentPageSchema>;
export type AdminAssignment = AdminAssignmentPage['assignments'][number];
