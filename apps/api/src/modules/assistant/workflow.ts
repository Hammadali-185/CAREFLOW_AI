import { workflowStateSchema, type ModelIntent, type WorkflowState } from '@careflow/shared';

export function emptyWorkflow(): WorkflowState {
  return {
    phase: 'collecting',
    intent: null,
    serviceQuery: null,
    datePreference: null,
    timePreference: null,
    staffQuery: null,
    serviceId: null,
    date: null,
    staffUserId: null,
    appointmentId: null,
    offeredSlots: [],
    selectedSlot: null,
    missingFields: [],
    confirmationState: 'not_required',
    turnKey: null,
    turnClaim: null,
    turnClaimedAt: null,
    turnSettled: false,
    turnOutcome: null,
    revision: 0,
  };
}

export function readWorkflow(value: unknown): WorkflowState {
  const parsed = workflowStateSchema.safeParse(value);
  return parsed.success ? parsed.data : emptyWorkflow();
}

export function effectiveIntent(previous: WorkflowState, extracted: ModelIntent) {
  if (
    extracted.intent === 'clarify' &&
    (previous.intent === 'book' ||
      previous.intent === 'cancel' ||
      previous.intent === 'reschedule' ||
      previous.intent === 'list')
  ) {
    return previous.intent;
  }
  return extracted.intent;
}

export function applyExtraction(previous: WorkflowState, extracted: ModelIntent) {
  const intent = effectiveIntent(previous, extracted);
  const next: WorkflowState = {
    ...previous,
    intent,
    missingFields: extracted.missingFields,
    confirmationState: needsConfirmation(intent) ? 'required' : 'not_required',
  };
  let preferenceChanged = false;

  if (extracted.serviceQuery !== null && extracted.serviceQuery !== previous.serviceQuery) {
    next.serviceQuery = extracted.serviceQuery;
    next.serviceId = null;
    preferenceChanged = true;
  }
  if (extracted.datePreference !== null && extracted.datePreference !== previous.datePreference) {
    next.datePreference = extracted.datePreference;
    next.date = null;
    preferenceChanged = true;
  }
  if (extracted.timePreference !== null && extracted.timePreference !== previous.timePreference) {
    next.timePreference = extracted.timePreference;
    preferenceChanged = true;
  }
  if (extracted.staffQuery !== null) {
    if (isAnyStaff(extracted.staffQuery)) {
      if (previous.staffQuery || previous.staffUserId) {
        preferenceChanged = true;
      }
      next.staffQuery = null;
      next.staffUserId = null;
    } else if (extracted.staffQuery !== previous.staffQuery) {
      next.staffQuery = extracted.staffQuery;
      next.staffUserId = null;
      preferenceChanged = true;
    }
  }

  if (previous.phase === 'completed') {
    next.phase = 'collecting';
    next.appointmentId = null;
    next.selectedSlot = null;
    next.offeredSlots = [];
  }

  if (preferenceChanged) {
    next.offeredSlots = [];
    next.selectedSlot = null;
    next.phase = 'collecting';
  }

  if (intent === 'unsupported') {
    next.offeredSlots = [];
    next.selectedSlot = null;
    next.appointmentId = null;
    next.phase = 'collecting';
  }

  if (intent === 'book' || intent === 'list') {
    next.appointmentId = null;
  }

  return { state: next, preferenceChanged };
}

export function needsConfirmation(intent: WorkflowState['intent']) {
  return intent === 'book' || intent === 'cancel' || intent === 'reschedule';
}

export function workflowSummary(state: WorkflowState) {
  return [
    `phase=${state.phase}`,
    `intent=${state.intent ?? 'unknown'}`,
    `service=${state.serviceQuery ?? 'unknown'}`,
    `date=${state.datePreference ?? 'unknown'}`,
    `time=${state.timePreference ?? 'unknown'}`,
    `staff=${state.staffQuery ?? 'unknown'}`,
  ].join('; ');
}

function isAnyStaff(value: string) {
  return /^(any|anyone|whoever|no preference|anybody)$/i.test(value.trim());
}
