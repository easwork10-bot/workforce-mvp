import 'server-only';
import { z } from 'zod';
import { uuidLikeString } from '@/shared/validation';

// Shift application
export const applyShiftSchema = z.object({
  shiftId: uuidLikeString('Invalid shift ID'),
});

// Application query params
export const applicationQuerySchema = z.object({
  status: z.enum(['pending', 'accepted', 'rejected', 'cancelled']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export const adminApplicationQuerySchema = applicationQuerySchema.extend({
  shiftId: uuidLikeString().optional(),
  employeeId: uuidLikeString().optional(),
}).strict();

export const reviewApplicationSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  rejectionReason: z.string().max(1000).optional(),
}).strict();

export const applicationIdParamSchema = z.object({
  id: uuidLikeString('Invalid application ID'),
});

// Export types
export type ApplyShiftInput = z.infer<typeof applyShiftSchema>;
export type ApplicationQueryInput = z.infer<typeof applicationQuerySchema>;
export type ReviewApplicationInput = z.infer<typeof reviewApplicationSchema>;