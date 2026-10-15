import { loginRequestSchema, signupRequestSchema } from '@careflow/shared';
import { z } from 'zod';

export const loginSchema = loginRequestSchema;

export const registerSchema = signupRequestSchema
  .extend({
    confirmPassword: z.string().min(1, 'Confirm your password.'),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
