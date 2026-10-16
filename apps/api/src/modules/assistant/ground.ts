import type { ModelIntent, WorkflowState } from '@careflow/shared';
import { resolveDatePreference, type CatalogService, type CatalogStaff } from './resolve.js';

export function groundMessage(input: {
  text: string;
  workflow: WorkflowState;
  services: CatalogService[];
  staff: CatalogStaff[];
  today: string;
}): ModelIntent | null {
  const normalized = normalize(input.text);
  if (!normalized) {
    return null;
  }

  const services = input.services.filter((service) => service.active);
  const serviceHits = services.filter((service) => normalize(service.name) === normalized);
  const staffHits = input.staff.filter((person) => normalize(person.displayName) === normalized);
  if (
    (serviceHits.length > 0 && staffHits.length > 0) ||
    serviceHits.length > 1 ||
    staffHits.length > 1
  ) {
    return null;
  }

  const service = serviceHits[0];
  if (serviceHits.length === 1 && service) {
    return detailIntent(continuingIntent(input.workflow), { serviceQuery: service.name });
  }

  const person = staffHits[0];
  if (staffHits.length === 1 && person) {
    return detailIntent(continuingIntent(input.workflow), { staffQuery: person.displayName });
  }

  const dateText = input.text.trim().toLowerCase().replace(/[.]/g, '').replace(/\s+/g, ' ');
  if (!isWholeDate(dateText)) {
    return null;
  }
  const date = resolveDatePreference(dateText, input.today);
  if (date.status !== 'resolved') {
    return null;
  }
  return detailIntent(continuingIntent(input.workflow), { datePreference: input.text.trim() });
}

const weekday = 'monday|tuesday|wednesday|thursday|friday|saturday|sunday';
const month =
  'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec';

function isWholeDate(text: string) {
  return (
    /^(?:today|tomorrow)$/.test(text) ||
    new RegExp(`^(?:next|this) (?:${weekday})$`).test(text) ||
    new RegExp(`^(?:${weekday})$`).test(text) ||
    /^\d{4}-\d{2}-\d{2}$/.test(text) ||
    new RegExp(`^(?:${month}) \\d{1,2}(?:st|nd|rd|th)?(?:, \\d{4})?$`).test(text)
  );
}

function continuingIntent(workflow: WorkflowState): ModelIntent['intent'] {
  if (
    workflow.intent === 'cancel' ||
    workflow.intent === 'reschedule' ||
    workflow.intent === 'list'
  ) {
    return workflow.intent;
  }
  return 'book';
}

function detailIntent(
  intent: ModelIntent['intent'],
  fields: Partial<Pick<ModelIntent, 'serviceQuery' | 'datePreference' | 'staffQuery'>>,
): ModelIntent {
  const scheduling = intent === 'book' || intent === 'cancel' || intent === 'reschedule';
  return {
    intent,
    serviceQuery: fields.serviceQuery ?? null,
    datePreference: fields.datePreference ?? null,
    timePreference: null,
    staffQuery: fields.staffQuery ?? null,
    contactName: null,
    contactPhone: null,
    missingFields: [],
    needsClarification: false,
    clarificationQuestion: null,
    proposedAction: scheduling ? 'search_availability' : 'ask',
    confirmationState: scheduling ? 'required' : 'not_required',
    emergency: false,
    topic: null,
  };
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
