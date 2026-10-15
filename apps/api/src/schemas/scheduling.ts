import {
  civilDateSchema,
  createAppointmentRequestSchema,
  createServiceRequestSchema,
  createTimeOffRequestSchema,
  replaceAvailabilityRequestSchema,
  rescheduleAppointmentRequestSchema,
  updateServiceRequestSchema,
} from '@careflow/shared';
import { z } from 'zod';

export const slotQuerySchema = z.object({
  serviceId: z.uuid('Choose a service.'),
  date: civilDateSchema,
  staffUserId: z.uuid('Choose a staff member.').optional(),
});

export const scheduleQuerySchema = z.object({
  from: z.string().min(1, 'Choose a start.'),
  to: z.string().min(1, 'Choose an end.'),
});

export const appointmentIdSchema = z.object({
  appointmentId: z.uuid('Enter an appointment id.'),
});

export const staffUserParamsSchema = z.object({
  clinicId: z.uuid('Enter a clinic id.'),
  staffUserId: z.uuid('Choose a staff member.'),
});

export const serviceIdParamsSchema = z.object({
  clinicId: z.uuid('Enter a clinic id.'),
  serviceId: z.uuid('Choose a service.'),
});

export const timeOffParamsSchema = z.object({
  clinicId: z.uuid('Enter a clinic id.'),
  timeOffId: z.uuid('Choose a time off entry.'),
});

export {
  createAppointmentRequestSchema,
  createServiceRequestSchema,
  createTimeOffRequestSchema,
  replaceAvailabilityRequestSchema,
  rescheduleAppointmentRequestSchema,
  updateServiceRequestSchema,
};
