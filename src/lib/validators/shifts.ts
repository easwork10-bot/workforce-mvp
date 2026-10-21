import { z } from 'zod';

// Shift creation
export const createShiftSchema = z.object({
  title: z.string().min(3, 'Title must be at least 3 characters').max(100).trim(),
  workType: z.string().min(2, 'Work type is required').max(50).trim(),
  clientOrProject: z.string().max(100).optional().nullable(),
  location: z.string().min(3, 'Location is required').max(200).trim(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  requiredWorkers: z.number().int().positive('At least 1 worker required').max(100),
  compensationType: z.enum(['hourly', 'fixed', 'daily']).default('hourly'),
  compensationAmount: z.number().positive('Compensation must be positive').max(10000).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  status: z.enum(['draft', 'open', 'filled', 'cancelled', 'completed']).default('draft'),
}).refine((data) => new Date(data.endAt) > new Date(data.startAt), {
  message: 'End time must be after start time',
  path: ['endAt'],
});

// Shift update (all fields optional)
export const updateShiftSchema = z.object({
  title: z.string().min(3).max(100).trim().optional(),
  workType: z.string().min(2).max(50).trim().optional(),
  clientOrProject: z.string().max(100).optional().nullable(),
  location: z.string().min(3).max(200).trim().optional(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  requiredWorkers: z.number().int().positive().max(100).optional(),
  compensationType: z.enum(['hourly', 'fixed', 'daily']).optional(),
  compensationAmount: z.number().positive().max(10000).optional().nullable(),
  description: z.string().max(2000).optional().nullable(),
  instructions: z.string().max(2000).optional().nullable(),
  status: z.enum(['draft', 'open', 'filled', 'cancelled', 'completed']).optional(),
}).refine((data) => {
  if (data.startAt && data.endAt) {
    return new Date(data.endAt) > new Date(data.startAt);
  }
  return true;
}, {
  message: 'End time must be after start time',
  path: ['endAt'],
});

// Shift query params
export const shiftQuerySchema = z.object({
  status: z.enum(['draft', 'open', 'filled', 'cancelled', 'completed']).optional(),
  workType: z.string().optional(),
  startFrom: z.string().datetime({ offset: true }).optional(),
  startTo: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['startAt', 'createdAt', 'title']).default('startAt'),
  sortOrder: z.enum(['asc', 'desc']).default('asc'),
});

// Shift ID param
export const shiftIdParamSchema = z.object({
  id: z.string().uuid('Invalid shift ID'),
});

// Export types
export type CreateShiftInput = z.infer<typeof createShiftSchema>;
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;
export type ShiftQueryInput = z.infer<typeof shiftQuerySchema>;
export type ShiftIdParam = z.infer<typeof shiftIdParamSchema>;