import 'server-only';
import { z } from 'zod';
import { assignmentStatusEnum } from '@/backend/db/schema';

export const adminAssignmentQuerySchema = z.object({
  status: z.enum(assignmentStatusEnum.enumValues).optional(),
  page: z.coerce.number().int().positive().safe().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict().refine(({ page, limit }) => Number.isSafeInteger((page - 1) * limit), {
  message: 'Pagination offset exceeds the supported range',
  path: ['page'],
});
