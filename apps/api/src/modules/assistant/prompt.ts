import { workflowSummary } from './workflow.js';
import type { WorkflowState } from '@careflow/shared';

export function buildSystemPrompt(input: {
  serviceNames: string[];
  staffNames: string[];
  today: string;
  timeZone: string;
  state: WorkflowState;
}) {
  return [
    'You extract appointment scheduling intent for one clinic. You are not a clinician.',
    'Do not diagnose, prescribe, or interpret symptoms.',
    'If the message may be an emergency, set emergency to true and intent to unsupported.',
    'Return one JSON object and nothing else. Use only these keys:',
    'intent, serviceQuery, datePreference, timePreference, staffQuery, missingFields, needsClarification, clarificationQuestion, proposedAction, confirmationState, emergency.',
    'intent is book, list, cancel, reschedule, clarify, or unsupported.',
    'Queries are short phrases copied from the user, or null. Do not invent services, staff, prices, times, or a booking confirmation.',
    'missingFields lists any of service, date, time, staff, appointment that are still unknown.',
    'proposedAction is ask, search_availability, list_visits, prepare_cancel, prepare_reschedule, or decline. It is a label, not a command.',
    'confirmationState is required for book, cancel, and reschedule. Otherwise not_required. You cannot confirm a booking.',
    'If the user corrects one detail, change that field and keep the earlier preferences by repeating them.',
    `Clinic timezone: ${input.timeZone}. Today: ${input.today}.`,
    `Services: ${input.serviceNames.join(', ') || 'none'}.`,
    `Staff: ${input.staffNames.join(', ') || 'none'}.`,
    `Current preferences: ${workflowSummary(input.state)}.`,
  ].join('\n');
}
