import 'server-only';
import { z } from 'zod';
import { uuidLikeString } from '@/shared/validation';

export const auditLogQuerySchema = z.object({
  actorId: uuidLikeString().optional(),
  entityType: z.string().trim().min(1).max(100).optional(),
  entityId: uuidLikeString().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict();
