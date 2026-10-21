import { z } from 'zod';

// Check-in
export const checkInSchema = z.object({
  shiftAssignmentId: z.string().uuid('Invalid shift assignment ID'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

// Check-out
export const checkOutSchema = z.object({
  shiftAssignmentId: z.string().uuid('Invalid shift assignment ID'),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
});

// Attendance query params
export const attendanceQuerySchema = z.object({
  shiftId: z.string().uuid().optional(),
  employeeId: z.string().uuid().optional(),
  status: z.enum(['checked_in', 'checked_out', 'late', 'absent', 'missed_checkout']).optional(),
  dateFrom: z.string().date().optional(),
  dateTo: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

// Export types
export type CheckInInput = z.infer<typeof checkInSchema>;
export type CheckOutInput = z.infer<typeof checkOutSchema>;
export type AttendanceQueryInput = z.infer<typeof attendanceQuerySchema>;