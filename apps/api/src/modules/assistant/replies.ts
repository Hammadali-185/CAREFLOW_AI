import type { AppointmentRecord, Slot, WorkflowState } from '@careflow/shared';

export function describeSlots(input: {
  closed: boolean;
  relaxed: boolean;
  slots: Slot[];
  timeZone: string;
  serviceName: string;
  date: string;
}) {
  if (input.closed) {
    return `${input.serviceName} has no working hours on ${input.date}. Choose another day. Nothing is booked.`;
  }
  if (input.slots.length === 0) {
    return `There is no open ${input.serviceName} time on ${input.date}. Nothing is booked.`;
  }
  const lines = input.slots.map(
    (slot) => `${formatWhen(slot.startsAt, input.timeZone)} with ${slot.staffName}`,
  );
  const lead = input.relaxed
    ? `That time is not open. These are open ${input.serviceName} times on ${input.date}:`
    : `These are open ${input.serviceName} times on ${input.date}:`;
  return `${lead}\n${lines.join('\n')}\nChoose one. Nothing is booked until you confirm.`;
}

export function describeReview(input: {
  clinicName: string;
  serviceName: string;
  staffName: string;
  startsAt: string;
  timeZone: string;
  moving: boolean;
}) {
  const when = formatWhen(input.startsAt, input.timeZone);
  const verb = input.moving ? 'Move the visit to' : 'Book';
  return `${verb} ${input.serviceName} at ${input.clinicName} on ${when} with ${input.staffName}. This is not saved until you confirm.`;
}

export function describeCancel(visit: AppointmentRecord, timeZone: string) {
  return `Cancel the ${visit.serviceName} on ${formatWhen(visit.startsAt, timeZone)} with ${visit.staffName} at ${visit.clinicName}? Nothing is cancelled until you confirm.`;
}

export function describeBooked(visit: AppointmentRecord, timeZone: string, moved: boolean) {
  const when = formatWhen(visit.startsAt, timeZone);
  if (moved) {
    return `Your ${visit.serviceName} is now ${when} with ${visit.staffName} at ${visit.clinicName}.`;
  }
  if (visit.status === 'cancelled') {
    return `The ${visit.serviceName} on ${when} with ${visit.staffName} is cancelled.`;
  }
  return `Your ${visit.serviceName} is confirmed for ${when} with ${visit.staffName} at ${visit.clinicName}.`;
}

export function describeVisits(visits: AppointmentRecord[], timeZone: string) {
  if (visits.length === 0) {
    return 'You have no upcoming visits at this clinic.';
  }
  const lines = visits.map(
    (visit) =>
      `${visit.serviceName} on ${formatWhen(visit.startsAt, timeZone)} with ${visit.staffName} (${visit.status})`,
  );
  return `These are the upcoming visits on your record:\n${lines.join('\n')}`;
}

export function describeChoices(visits: AppointmentRecord[], timeZone: string, action: string) {
  const lines = visits.map(
    (visit) =>
      `${visit.serviceName} on ${formatWhen(visit.startsAt, timeZone)} with ${visit.staffName}`,
  );
  return `Which visit should I ${action}?\n${lines.join('\n')}`;
}

export function suggestionsFor(state: WorkflowState, serviceNames: string[]) {
  if (state.missingFields.includes('service')) {
    return serviceNames.slice(0, 4);
  }
  if (state.missingFields.includes('date')) {
    return ['Tomorrow', 'Next Monday'];
  }
  if (state.phase === 'awaiting_slot' || state.phase === 'awaiting_reschedule_slot') {
    return [];
  }
  return ['Show my visits'];
}

export function formatWhen(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function slotStillOffered(slots: Slot[], staffUserId: string, startsAt: string) {
  return slots.some((slot) => slot.staffUserId === staffUserId && slot.startsAt === startsAt);
}
