import type { AppointmentRecord, Slot, WorkflowState } from '@careflow/shared';
import { bookingRules } from '../scheduling/rules.js';

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
  contactName?: string | null;
  contactPhone?: string | null;
}) {
  const when = formatWhen(input.startsAt, input.timeZone);
  const verb = input.moving ? 'Move the visit to' : 'Book';
  const contact =
    input.contactName && input.contactPhone
      ? ` Name on the visit: ${input.contactName}. Phone: ${input.contactPhone}.`
      : '';
  return `${verb} ${input.serviceName} at ${input.clinicName} on ${when} with ${input.staffName}.${contact} This is not saved until you confirm.`;
}

export function askForContact(missing: Array<'name' | 'phone'>) {
  if (missing.includes('name') && missing.includes('phone')) {
    return 'What name should appear on this visit, and what phone number can the clinic use to reach you?';
  }
  if (missing.includes('name')) {
    return 'What name should appear on this visit?';
  }
  return 'What phone number can the clinic use to reach you?';
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

export function describeServices(
  services: Array<{ name: string; durationMinutes: number; active: boolean }>,
) {
  const active = services.filter((service) => service.active);
  if (active.length === 0) {
    return 'This clinic has no services available to book right now.';
  }
  const lines = active.map((service) => `${service.name} (${service.durationMinutes} minutes)`);
  return `These are the visits this clinic offers:\n${lines.join('\n')}\nTell me which one you want and which day. Nothing is booked until you confirm.`;
}

export function describeSchedule() {
  return `Open times come from this clinic's schedule after you choose a visit and a day. You can request a time from today through the next ${bookingRules.horizonDays} days, at least ${bookingRules.minimumNoticeMinutes} minutes from now. I only offer times that are actually open.`;
}

export function describePolicy() {
  return 'A visit is saved only after you confirm an open time. You can list, move, or cancel your own upcoming visits here, and a cancellation is saved only after you confirm it. I do not have prices, preparation instructions, or other clinic policies.';
}

export function describeLimits() {
  return 'I can book, list, move, or cancel a visit, and I can answer from this clinic service list and scheduling rules. I cannot help with that request. You can also use the booking form.';
}

export function suggestionsFor(state: WorkflowState, serviceNames: string[]) {
  if (state.missingFields.includes('service')) {
    return serviceNames.slice(0, 4);
  }
  if (state.missingFields.includes('date')) {
    return ['Tomorrow', 'Next Monday'];
  }
  if (state.missingFields.includes('name') || state.missingFields.includes('phone')) {
    return [];
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
