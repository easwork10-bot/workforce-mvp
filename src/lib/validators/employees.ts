import { z } from 'zod';

// Employee query params
export const employeeQuerySchema = z.object({
  role: z.enum(['administrator', 'supervisor', 'employee']).optional(),
  accountStatus: z.enum(['active', 'inactive', 'suspended']).optional(),
  search: z.string().max(100).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  sortBy: z.enum(['fullName', 'email', 'createdAt']).default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// Employee ID param
export const employeeIdParamSchema = z.object({
  id: z.string().uuid('Invalid employee ID'),
});

// Employee update (admin only)
export const updateEmployeeSchema = z.object({
  fullName: z.string().min(2).max(100).trim().optional(),
  phone: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  preferredLanguage: z.enum(['nl', 'ar', 'en']).optional(),
  accountStatus: z.enum(['active', 'inactive', 'suspended']).optional(),
  role: z.enum(['administrator', 'supervisor', 'employee']).optional(),
  workCategories: z.array(z.string()).optional(),
  employmentType: z.enum(['permanent', 'temporary', 'freelance']).optional(),
  hourlyRate: z.number().positive().max(1000).optional().nullable(),
  bankAccountIban: z.string().max(50).optional().nullable(),
  bankAccountName: z.string().max(100).optional().nullable(),
  emergencyContactName: z.string().max(100).optional().nullable(),
  emergencyContactPhone: z.string().max(20).optional().nullable(),
  address: z.string().max(200).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  dateOfBirth: z.string().date().optional().nullable(),
  bsNumber: z.string().max(20).optional().nullable(),
});

// Export types
export type EmployeeQueryInput = z.infer<typeof employeeQuerySchema>;
export type EmployeeIdParam = z.infer<typeof employeeIdParamSchema>;
export type UpdateEmployeeInput = z.infer<typeof updateEmployeeSchema>;