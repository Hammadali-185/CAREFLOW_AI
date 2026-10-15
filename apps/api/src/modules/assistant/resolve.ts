import type { Slot, WorkflowState } from '@careflow/shared';
import { bookingRules } from '../scheduling/rules.js';
import { addCivilDays, clinicToday, isCivilDate, weekdayIso } from '../scheduling/time.js';

const weekdays = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

const months: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};

export type DateResolution =
  | { status: 'missing' }
  | { status: 'ambiguous'; question: string }
  | { status: 'invalid' }
  | { status: 'outside' }
  | { status: 'resolved'; date: string };

export type CatalogService = { id: string; name: string; active: boolean };
export type CatalogStaff = { userId: string; displayName: string };

export function resolveDatePreference(
  preference: string | null,
  today: string,
  horizonDays = bookingRules.horizonDays,
): DateResolution {
  if (!preference || preference.trim().length === 0) {
    return { status: 'missing' };
  }
  const text = preference.trim().toLowerCase().replace(/[.]/g, '');
  const namedDays = weekdays.filter((day) => new RegExp(`\\b${day}\\b`).test(text));
  if (namedDays.length > 1) {
    return {
      status: 'ambiguous',
      question: 'That could be more than one day. Which day should I check?',
    };
  }
  if (/\bnext week\b/.test(text) && namedDays.length === 0) {
    return {
      status: 'ambiguous',
      question: 'Which day next week should I check?',
    };
  }

  let date: string | null;
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(text);
  if (iso?.[1]) {
    if (!isCivilDate(iso[1])) {
      return { status: 'invalid' };
    }
    date = iso[1];
  } else if (text === 'today') {
    date = today;
  } else if (text === 'tomorrow') {
    date = addCivilDays(today, 1);
  } else if (namedDays.length === 1) {
    const namedDay = namedDays[0];
    if (!namedDay) {
      return { status: 'ambiguous', question: 'Which day should I check?' };
    }
    const target = weekdays.indexOf(namedDay) + 1;
    const current = weekdayIso(today);
    const forceNext = text.startsWith('next ');
    let delta = (target - current + 7) % 7;
    if (forceNext && delta === 0) {
      delta = 7;
    }
    if (!forceNext && delta === 0 && !text.startsWith('this ')) {
      return {
        status: 'ambiguous',
        question: `Do you mean today, or ${namedDay} next week?`,
      };
    }
    if (text.startsWith('this ') && delta === 0) {
      date = today;
    } else if (text.startsWith('this ') && target < current) {
      return {
        status: 'ambiguous',
        question: `${namedDay[0]?.toUpperCase() ?? ''}${namedDay.slice(1)} this week has already passed. Do you mean next week?`,
      };
    } else {
      date = addCivilDays(today, delta);
    }
  } else {
    const monthMatch =
      /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/.exec(
        text,
      );
    if (!monthMatch?.[1] || !monthMatch[2]) {
      return {
        status: 'ambiguous',
        question: 'I could not tell which day you mean. Use a date such as October 20.',
      };
    }
    const month = months[monthMatch[1]];
    const day = Number(monthMatch[2]);
    const year = monthMatch[3] ? Number(monthMatch[3]) : Number(today.slice(0, 4));
    const candidate = civil(year, month ?? 0, day);
    if (!candidate) {
      return { status: 'invalid' };
    }
    date = candidate;
  }

  if (!date) {
    return { status: 'ambiguous', question: 'Which day should I check?' };
  }
  const last = addCivilDays(today, horizonDays);
  if (date < today || date > last) {
    return { status: 'outside' };
  }
  return { status: 'resolved', date };
}

export type TimeInterpretation =
  | { kind: 'none' }
  | { kind: 'any' }
  | { kind: 'period'; start: number; end: number }
  | { kind: 'clock'; minute: number }
  | { kind: 'unclear' };

export function interpretTime(preference: string | null): TimeInterpretation {
  if (!preference || preference.trim().length === 0) {
    return { kind: 'none' };
  }
  const text = preference.trim().toLowerCase();
  if (/^(any|anytime|any time|whenever|no preference)$/.test(text)) {
    return { kind: 'any' };
  }
  if (text.includes('morning')) {
    return { kind: 'period', start: 0, end: 12 * 60 };
  }
  if (text.includes('afternoon')) {
    return { kind: 'period', start: 12 * 60, end: 17 * 60 };
  }
  if (text.includes('evening')) {
    return { kind: 'period', start: 17 * 60, end: 24 * 60 };
  }
  const clock = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/.exec(text);
  if (!clock?.[1]) {
    return { kind: 'unclear' };
  }
  let hour = Number(clock[1]);
  const minute = Number(clock[2] ?? '0');
  const meridiem = clock[3];
  if (minute > 59 || hour > 23) {
    return { kind: 'unclear' };
  }
  if (meridiem === 'pm' && hour < 12) {
    hour += 12;
  }
  if (meridiem === 'am' && hour === 12) {
    hour = 0;
  }
  if (!meridiem && hour <= 7) {
    hour += 12;
  }
  if (hour > 23) {
    return { kind: 'unclear' };
  }
  return { kind: 'clock', minute: hour * 60 + minute };
}

export function filterSlots(slots: Slot[], preference: string | null, timeZone: string) {
  const interpreted = interpretTime(preference);
  if (interpreted.kind === 'none' || interpreted.kind === 'any') {
    return { slots, relaxed: false, unclear: false };
  }
  if (interpreted.kind === 'unclear') {
    return { slots: [], relaxed: false, unclear: true };
  }
  const matched = slots.filter((slot) => {
    const minute = minuteInZone(slot.startsAt, timeZone);
    if (interpreted.kind === 'period') {
      return minute >= interpreted.start && minute < interpreted.end;
    }
    return Math.abs(minute - interpreted.minute) <= 60;
  });
  if (matched.length === 0) {
    return { slots, relaxed: true, unclear: false };
  }
  return { slots: matched, relaxed: false, unclear: false };
}

export function resolveService(query: string | null, services: CatalogService[]) {
  const active = services.filter((service) => service.active);
  if (!query) {
    return { status: 'missing' as const, matches: active };
  }
  const needle = normalize(query);
  const matches = active.filter((service) => {
    const name = normalize(service.name);
    return name === needle || name.includes(needle) || needle.includes(name);
  });
  if (matches.length === 1) {
    return { status: 'one' as const, service: matches[0] };
  }
  if (matches.length === 0) {
    return { status: 'none' as const, names: active.map((service) => service.name) };
  }
  return { status: 'many' as const, names: matches.map((service) => service.name) };
}

export function resolveStaff(query: string | null, staff: CatalogStaff[]) {
  if (!query) {
    return { status: 'any' as const };
  }
  const needle = normalize(query);
  const matches = staff.filter((person) => {
    const name = normalize(person.displayName);
    const tokens = name.split(' ');
    return name.includes(needle) || tokens.some((token) => token.startsWith(needle));
  });
  if (matches.length === 1) {
    return { status: 'one' as const, person: matches[0] };
  }
  if (matches.length === 0) {
    return { status: 'none' as const, names: staff.map((person) => person.displayName) };
  }
  return { status: 'many' as const, names: matches.map((person) => person.displayName) };
}

export function resolveBookingDetails(input: {
  state: WorkflowState;
  services: CatalogService[];
  staff: CatalogStaff[];
  today: string;
}) {
  const missing: WorkflowState['missingFields'] = [];
  let question: string | null = null;
  let serviceId = input.state.serviceId;
  let date = input.state.date;
  let staffUserId = input.state.staffUserId;

  if (input.state.serviceQuery) {
    const service = resolveService(input.state.serviceQuery, input.services);
    if (service.status === 'one' && service.service) {
      serviceId = service.service.id;
    } else if (service.status === 'none') {
      serviceId = null;
      question = `This clinic does not offer ${input.state.serviceQuery}. Services here are ${service.names.join(', ')}.`;
    } else if (service.status === 'many') {
      serviceId = null;
      missing.push('service');
      question = `Which service do you mean? ${service.names.join(', ')}.`;
    }
  } else if (!serviceId && input.state.intent === 'book') {
    missing.push('service');
    const names = input.services.filter((service) => service.active).map((service) => service.name);
    question = `Which service should I look up? ${names.join(', ')}.`;
  }

  if (!question && input.state.datePreference && !date) {
    const resolved = resolveDatePreference(input.state.datePreference, input.today);
    if (resolved.status === 'resolved') {
      date = resolved.date;
    } else if (resolved.status === 'ambiguous') {
      missing.push('date');
      question = resolved.question;
    } else if (resolved.status === 'invalid') {
      missing.push('date');
      question = 'That date is not a real calendar day. Which day should I check?';
    } else if (resolved.status === 'outside') {
      missing.push('date');
      question =
        'That day is outside the booking window. Choose a day from today through the next 60 days.';
    } else {
      missing.push('date');
    }
  } else if (
    !question &&
    !date &&
    (input.state.intent === 'book' || input.state.intent === 'reschedule')
  ) {
    missing.push('date');
    question = 'Which day should I check?';
  }

  if (
    !question &&
    input.state.timePreference &&
    interpretTime(input.state.timePreference).kind === 'unclear'
  ) {
    missing.push('time');
    question = 'What time of day works, such as morning or 2:00 PM?';
  }

  if (!question && input.state.staffQuery) {
    const staff = resolveStaff(input.state.staffQuery, input.staff);
    if (staff.status === 'one' && staff.person) {
      staffUserId = staff.person.userId;
    } else if (staff.status === 'none') {
      staffUserId = null;
      question = `I could not match that name. Staff here are ${staff.names.join(', ')}.`;
    } else if (staff.status === 'many') {
      staffUserId = null;
      missing.push('staff');
      question = `Which person do you mean? ${staff.names.join(', ')}.`;
    }
  }

  return { serviceId, date, staffUserId, missing, question };
}

export function minuteInZone(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  return hour * 60 + minute;
}

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function civil(year: number, month: number, day: number) {
  const value = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isCivilDate(value) ? value : null;
}

export function clinicDate(now: Date, timeZone: string) {
  return clinicToday(now, timeZone);
}
