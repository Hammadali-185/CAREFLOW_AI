import type { ModelIntent } from '@careflow/shared';

function normalize(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function screenedIntent(
  text: string,
  serviceNames: readonly string[],
): ModelIntent | null {
  const normalized = normalize(text);
  if (normalized.length === 0) {
    return null;
  }
  if (normalized === 'show my visits') {
    return intent({ intent: 'list', proposedAction: 'list_visits' });
  }
  if (normalized === 'tomorrow' || normalized === 'next monday') {
    return intent({
      intent: 'clarify',
      datePreference: normalized,
      proposedAction: 'search_availability',
      missingFields: ['date'],
    });
  }
  const service = serviceNames.find((name) => normalize(name) === normalized);
  if (!service) {
    return null;
  }
  return intent({
    intent: 'book',
    serviceQuery: service,
    proposedAction: 'ask',
    missingFields: ['date'],
  });
}

function intent(
  partial: Pick<ModelIntent, 'intent' | 'proposedAction'> &
    Partial<Pick<ModelIntent, 'serviceQuery' | 'datePreference' | 'missingFields'>>,
): ModelIntent {
  return {
    intent: partial.intent,
    serviceQuery: partial.serviceQuery ?? null,
    datePreference: partial.datePreference ?? null,
    timePreference: null,
    staffQuery: null,
    missingFields: partial.missingFields ?? [],
    needsClarification: false,
    clarificationQuestion: null,
    proposedAction: partial.proposedAction,
    confirmationState: 'not_required',
    emergency: false,
  };
}
