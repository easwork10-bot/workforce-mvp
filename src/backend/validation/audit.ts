import 'server-only';
import { z } from 'zod';

export const auditLogQuerySchema = z.object({
  actorId: z.string().uuid().optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict();
