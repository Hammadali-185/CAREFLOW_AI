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
    'intent, serviceQuery, datePreference, timePreference, staffQuery, missingFields, needsClarification, clarificationQuestion, proposedAction, confirmationState, emergency, topic.',
    'intent is book, list, cancel, reschedule, clarify, or unsupported.',
    'topic is services, schedule, policy, or null. Use services when the user asks which visits exist. Use schedule when they ask how open times are found. Use policy when they ask how confirmation or cancellation works. Leave topic null for booking details and for questions you cannot classify. Do not answer medical, price, or preparation questions.',
    'A short reply can fill the missing detail from the current preferences. Do not drop details the user already gave.',
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
