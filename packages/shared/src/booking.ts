import { z } from 'zod';

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

export const appointmentStatusSchema = z.enum([
  'requested',
  'confirmed',
  'cancelled',
  'completed',
  'no_show',
]);

export const civilDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date as YYYY-MM-DD.');

export const serviceSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  durationMinutes: z.number().int(),
  active: z.boolean(),
});

export const serviceListResponseSchema = z.object({
  services: z.array(serviceSchema),
});

export const staffMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  role: z.enum(['owner', 'staff']),
});

export const staffListResponseSchema = z.object({
  staff: z.array(staffMemberSchema),
});

export const slotSchema = z.object({
  staffUserId: z.uuid(),
  staffName: z.string(),
  startsAt: z.string(),
  endsAt: z.string(),
});

export const slotSearchResponseSchema = z.object({
  date: z.string(),
  timezone: z.string(),
  closed: z.boolean(),
  slots: z.array(slotSchema),
});

export const appointmentSchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  clinicName: z.string(),
  serviceId: z.uuid(),
  serviceName: z.string(),
  durationMinutes: z.number().int(),
  staffUserId: z.uuid(),
  staffName: z.string(),
  status: appointmentStatusSchema,
  startsAt: z.string(),
  endsAt: z.string(),
  cancelledAt: z.string().nullable(),
});

export const appointmentResponseSchema = z.object({
  appointment: appointmentSchema,
  replayed: z.boolean().optional(),
});

export const appointmentListResponseSchema = z.object({
  appointments: z.array(appointmentSchema),
});

export const createAppointmentRequestSchema = z.object({
  serviceId: z.uuid('Choose a service.'),
  staffUserId: z.uuid('Choose a staff member.'),
  startsAt: z.string().min(1, 'Choose a time.'),
});

export const rescheduleAppointmentRequestSchema = z.object({
  staffUserId: z.uuid('Choose a staff member.'),
  startsAt: z.string().min(1, 'Choose a time.'),
});

export const createServiceRequestSchema = z.object({
  name: z.string().trim().min(1, 'Enter a service name.').max(80, 'Use at most 80 characters.'),
  durationMinutes: z
    .number()
    .int()
    .min(5, 'Use at least 5 minutes.')
    .max(480, 'Use at most 8 hours.'),
});

export const updateServiceRequestSchema = createServiceRequestSchema
  .partial()
  .extend({
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Choose a change to save.' });

export const availabilityWindowSchema = z.object({
  weekday: z.number().int().min(1, 'Choose a weekday.').max(7, 'Choose a weekday.'),
  startsMinute: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
  endsMinute: z
    .number()
    .int()
    .min(0)
    .max(24 * 60),
});

export const replaceAvailabilityRequestSchema = z.object({
  windows: z.array(availabilityWindowSchema).max(40, 'Use at most 40 windows.'),
});

export const availabilityResponseSchema = z.object({
  staffUserId: z.uuid(),
  windows: z.array(availabilityWindowSchema),
  timeOff: z.array(
    z.object({
      id: z.uuid(),
      startsAt: z.string(),
      endsAt: z.string(),
      reason: z.string().nullable(),
    }),
  ),
});

export const createTimeOffRequestSchema = z.object({
  startsAt: z.string().min(1, 'Choose a start.'),
  endsAt: z.string().min(1, 'Choose an end.'),
  reason: z.string().trim().max(120, 'Use at most 120 characters.').optional(),
});

export const scheduleResponseSchema = z.object({
  staffUserId: z.uuid(),
  appointments: z.array(appointmentSchema),
});

export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;
export type ServiceRecord = z.infer<typeof serviceSchema>;
export type StaffMember = z.infer<typeof staffMemberSchema>;
export type Slot = z.infer<typeof slotSchema>;
export type SlotSearchResponse = z.infer<typeof slotSearchResponseSchema>;
export type AppointmentRecord = z.infer<typeof appointmentSchema>;
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentRequestSchema>;
export type CreateServiceRequest = z.infer<typeof createServiceRequestSchema>;
export type UpdateServiceRequest = z.infer<typeof updateServiceRequestSchema>;
export type AvailabilityWindow = z.infer<typeof availabilityWindowSchema>;
export type ReplaceAvailabilityRequest = z.infer<typeof replaceAvailabilityRequestSchema>;
export type AvailabilityResponse = z.infer<typeof availabilityResponseSchema>;
export type CreateTimeOffRequest = z.infer<typeof createTimeOffRequestSchema>;
export type ScheduleResponse = z.infer<typeof scheduleResponseSchema>;
