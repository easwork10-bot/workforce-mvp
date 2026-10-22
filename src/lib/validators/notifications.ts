import { z } from 'zod';

export const notificationQuerySchema = z.object({
  type: z.enum([
    'shift_created',
    'application_received',
    'application_accepted',
    'application_rejected',
    'shift_updated',
    'shift_cancelled',
    'upcoming_shift',
    'check_in_reminder',
    'check_out_reminder',
  ]).optional(),
  isRead: z.enum(['true', 'false', 'all']).default('false'),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
}).strict();

export const markNotificationReadSchema = z.object({
  read: z.literal(true),
}).strict();

export const notificationIdSchema = z.string().uuid();
