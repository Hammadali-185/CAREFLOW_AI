import { z } from 'zod';
import { appointmentSchema, civilDateSchema, slotSchema } from './booking.js';

export const assistantIntentNameSchema = z.enum([
  'book',
  'list',
  'cancel',
  'reschedule',
  'clarify',
  'unsupported',
]);

export const assistantMissingFieldSchema = z.enum([
  'service',
  'date',
  'time',
  'staff',
  'appointment',
]);

export const assistantProposedActionSchema = z.enum([
  'ask',
  'search_availability',
  'list_visits',
  'prepare_cancel',
  'prepare_reschedule',
  'decline',
]);

export const assistantConfirmationStateSchema = z.enum(['not_required', 'required']);

export const assistantTopicSchema = z.enum(['services', 'schedule', 'policy']);

export const modelIntentSchema = z
  .object({
    intent: assistantIntentNameSchema,
    serviceQuery: z.string().max(120).nullable(),
    datePreference: z.string().max(80).nullable(),
    timePreference: z.string().max(80).nullable(),
    staffQuery: z.string().max(120).nullable(),
    missingFields: z.array(assistantMissingFieldSchema).max(5),
    needsClarification: z.boolean(),
    clarificationQuestion: z.string().max(400).nullable(),
    proposedAction: assistantProposedActionSchema,
    confirmationState: assistantConfirmationStateSchema,
    emergency: z.boolean(),
    topic: assistantTopicSchema.nullable().default(null),
  })
  .strict();

export const assistantPhaseSchema = z.enum([
  'collecting',
  'awaiting_slot',
  'awaiting_confirmation',
  'awaiting_cancel_confirmation',
  'awaiting_reschedule_slot',
  'awaiting_reschedule_confirmation',
  'completed',
]);

export const assistantOutcomeSchema = z.enum([
  'loaded',
  'reply',
  'slots',
  'review',
  'booked',
  'cancelled',
  'rescheduled',
  'listed',
  'invalid_output',
  'unavailable',
  'emergency',
]);

export const workflowStateSchema = z.object({
  phase: assistantPhaseSchema,
  intent: assistantIntentNameSchema.nullable(),
  serviceQuery: z.string().nullable(),
  datePreference: z.string().nullable(),
  timePreference: z.string().nullable(),
  staffQuery: z.string().nullable(),
  serviceId: z.uuid().nullable(),
  date: civilDateSchema.nullable(),
  staffUserId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable(),
  offeredSlots: z.array(slotSchema).max(16),
  selectedSlot: slotSchema.nullable(),
  missingFields: z.array(assistantMissingFieldSchema).max(5),
  confirmationState: assistantConfirmationStateSchema,
  turnKey: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,80}$/)
    .nullable()
    .default(null),
  turnClaim: z.string().min(1).max(80).nullable().default(null),
  turnClaimedAt: z.string().min(1).max(40).nullable().default(null),
  turnSettled: z.boolean().default(false),
  turnOutcome: assistantOutcomeSchema.nullable().default(null),
  revision: z.number().int().nonnegative().default(0),
});

export const assistantMessageSchema = z.object({
  id: z.uuid(),
  senderKind: z.enum(['user', 'assistant', 'system']),
  body: z.string(),
  createdAt: z.string(),
});

export const assistantSessionSchema = z.object({
  id: z.uuid(),
  clinicId: z.uuid(),
  clinicName: z.string(),
  openedAt: z.string(),
  appointmentId: z.uuid().nullable(),
  preview: z.string().nullable(),
});

export const assistantSessionListSchema = z.object({
  sessions: z.array(assistantSessionSchema),
});

export const assistantTurnSchema = z.object({
  session: assistantSessionSchema,
  messages: z.array(assistantMessageSchema),
  workflow: workflowStateSchema,
  suggestions: z.array(z.string()).max(6),
  outcome: assistantOutcomeSchema,
  appointment: appointmentSchema.nullable(),
  manualBooking: z.object({
    serviceId: z.uuid().nullable(),
    date: civilDateSchema.nullable(),
  }),
});

export const assistantMessageRequestSchema = z.object({
  text: z.string().trim().min(1, 'Enter a message.').max(2000, 'Use at most 2000 characters.'),
  retry: z.boolean().optional(),
  turnKey: z
    .string()
    .regex(
      /^[A-Za-z0-9_-]{8,80}$/,
      'Use a turn key of 8 to 80 letters, numbers, underscores, or hyphens.',
    )
    .optional(),
});

export const assistantSlotRequestSchema = z.object({
  staffUserId: z.uuid('Choose a staff member.'),
  startsAt: z.string().min(1, 'Choose a time.'),
});

export const confirmAssistantRequestSchema = z.object({
  confirmed: z.literal(true, { message: 'Confirm the visit before it is saved.' }),
});

export type ModelIntent = z.infer<typeof modelIntentSchema>;
export type WorkflowState = z.infer<typeof workflowStateSchema>;
export type AssistantOutcome = z.infer<typeof assistantOutcomeSchema>;
export type AssistantTurn = z.infer<typeof assistantTurnSchema>;
export type AssistantSessionList = z.infer<typeof assistantSessionListSchema>;
