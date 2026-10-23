import 'server-only';
import { z } from 'zod';

// Login credentials
export const loginSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

// Registration
export const registerSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100).trim(),
  phone: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  preferredLanguage: z.enum(['nl', 'ar', 'en']).default('nl'),
});

// Password reset request
export const forgotPasswordSchema = z.object({
  email: z.string().email('Invalid email address').toLowerCase().trim(),
});

// Password reset
export const resetPasswordSchema = z.object({
  token: z.string().min(32, 'Invalid reset token'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

// Refresh token
export const refreshTokenSchema = z.object({
  refreshToken: z.string().min(32, 'Invalid refresh token'),
});

// Export types
export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RefreshTokenInput = z.infer<typeof refreshTokenSchema>;