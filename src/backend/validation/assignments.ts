import 'server-only';
import { z } from 'zod';
import { assignmentStatusEnum } from '@/backend/db/schema';
import { uuidLikeString } from '@/shared/validation';

const scheduleDateSchema = z.string().date().refine(value => !value.startsWith('0000-'), {
  message: 'Invalid date',
});

export const employeeScheduleQuerySchema = z.object({
  shiftId: uuidLikeString().optional(),
  employeeId: uuidLikeString().optional(),
  status: z.enum(assignmentStatusEnum.enumValues).optional(),
  dateFrom: scheduleDateSchema.optional(),
  dateTo: scheduleDateSchema.optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).refine(({ dateFrom, dateTo }) => !dateFrom || !dateTo || dateFrom <= dateTo, {
  message: 'End date must be on or after start date',
  path: ['dateTo'],
}).refine(({ page, limit }) => Number.isSafeInteger((page - 1) * limit), {
  message: 'Pagination offset exceeds the supported range',
  path: ['page'],
});

export const adminAssignmentQuerySchema = z.object({
  status: z.enum(assignmentStatusEnum.enumValues).optional(),
  page: z.coerce.number().int().positive().safe().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict().refine(({ page, limit }) => Number.isSafeInteger((page - 1) * limit), {
  message: 'Pagination offset exceeds the supported range',
  path: ['page'],
});
