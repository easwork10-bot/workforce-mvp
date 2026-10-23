import 'server-only';
import { z } from 'zod';

// Shift application
export const applyShiftSchema = z.object({
  shiftId: z.string().uuid('Invalid shift ID'),
});

// Application query params
export const applicationQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const reviewApplicationSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  rejectionReason: z.string().max(1000).optional(),
}).strict();

export const applicationIdParamSchema = z.object({
  id: z.string().uuid('Invalid application ID'),
});

// Export types
export type ApplyShiftInput = z.infer<typeof applyShiftSchema>;
export type ApplicationQueryInput = z.infer<typeof applicationQuerySchema>;
export type ReviewApplicationInput = z.infer<typeof reviewApplicationSchema>;