import {
  assistantMessageRequestSchema,
  assistantSlotRequestSchema,
  confirmAssistantRequestSchema,
} from '@careflow/shared';
import { z } from 'zod';

export const assistantSessionParamsSchema = z.object({
  sessionId: z.uuid('Choose a conversation.'),
});

export { assistantMessageRequestSchema, assistantSlotRequestSchema, confirmAssistantRequestSchema };
