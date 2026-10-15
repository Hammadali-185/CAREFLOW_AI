import { z } from 'zod';

export const CARE_FLOW_REQUEST_HEADER = 'X-CareFlow-Request';
export const CSRF_HEADER = 'X-CSRF-Token';

export const membershipRoleSchema = z.enum(['owner', 'staff', 'patient']);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Enter a valid email address.'));

export const signupPasswordSchema = z
  .string()
  .min(12, 'Use at least 12 characters.')
  .max(128, 'Use at most 128 characters.');

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.').max(128, 'Use at most 128 characters.'),
});

export const signupRequestSchema = z.object({
  email: emailSchema,
  password: signupPasswordSchema,
  displayName: z.string().trim().min(1, 'Enter your name.').max(120, 'Use at most 120 characters.'),
  businessSlug: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(
      z
        .string()
        .min(1, 'Enter the clinic slug.')
        .max(80, 'Use at most 80 characters.')
        .regex(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
          'Enter the clinic slug using lowercase letters and hyphens.',
        ),
    ),
});

export const membershipSchema = z.object({
  businessId: z.uuid(),
  businessName: z.string(),
  businessSlug: z.string(),
  role: membershipRoleSchema,
});

export const publicUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
  displayName: z.string(),
  memberships: z.array(membershipSchema),
});

export const authSessionResponseSchema = z.object({
  user: publicUserSchema,
  csrfToken: z.string().min(1),
});

export const clinicAccessSchema = z.enum(['member', 'staff', 'administrator']);

export const clinicSessionResponseSchema = z.object({
  clinic: z.object({
    id: z.uuid(),
    name: z.string(),
    slug: z.string(),
    timezone: z.string(),
  }),
  role: membershipRoleSchema,
  access: clinicAccessSchema,
});

export type MembershipRole = z.infer<typeof membershipRoleSchema>;
export type PublicUser = z.infer<typeof publicUserSchema>;
export type AuthSessionResponse = z.infer<typeof authSessionResponseSchema>;
export type LoginRequest = z.infer<typeof loginRequestSchema>;
export type SignupRequest = z.infer<typeof signupRequestSchema>;
export type ClinicSessionResponse = z.infer<typeof clinicSessionResponseSchema>;
