import { bookingRules, type BookingRules } from './rules.js';
import { addCivilDays, civilDateTimeToUtc, clinicToday, isCivilDate, weekdayIso } from './time.js';

export type BusyRange = {
  startsAt: Date;
  endsAt: Date;
};

export type StaffDayInput = {
  staffUserId: string;
  staffName: string;
  windows: Array<{ startsMinute: number; endsMinute: number }>;
  busy: BusyRange[];
  timeOff: BusyRange[];
};

export type OpenSlot = {
  staffUserId: string;
  staffName: string;
  startsAt: Date;
  endsAt: Date;
};

export type DateWindow = { ok: true } | { ok: false; reason: 'invalid' | 'outside' };

export function classifyDate(
  date: string,
  now: Date,
  timeZone: string,
  rules: BookingRules = bookingRules,
): DateWindow {
  if (!isCivilDate(date)) {
    return { ok: false, reason: 'invalid' };
  }
  const today = clinicToday(now, timeZone);
  const last = addCivilDays(today, rules.horizonDays);
  if (date < today || date > last) {
    return { ok: false, reason: 'outside' };
  }
  return { ok: true };
}

export function buildSlots(input: {
  date: string;
  timeZone: string;
  durationMinutes: number;
  now: Date;
  staff: StaffDayInput[];
  rules?: BookingRules;
}): { closed: boolean; slots: OpenSlot[] } {
  const rules = input.rules ?? bookingRules;
  const earliest = new Date(input.now.getTime() + rules.minimumNoticeMinutes * 60_000);
  const slots: OpenSlot[] = [];
  let anyWindow = false;
  let anyOpenBeforeAppointments = false;

  for (const person of input.staff) {
    if (person.windows.length > 0) {
      anyWindow = true;
    }
    const candidates = candidateStarts(
      input.date,
      input.timeZone,
      input.durationMinutes,
      person,
      rules,
    );
    if (candidates.length > 0) {
      anyOpenBeforeAppointments = true;
    }
    for (const start of candidates) {
      const end = new Date(start.getTime() + input.durationMinutes * 60_000);
      if (start < earliest) {
        continue;
      }
      if (person.busy.some((range) => overlaps(start, end, range.startsAt, range.endsAt))) {
        continue;
      }
      slots.push({
        staffUserId: person.staffUserId,
        staffName: person.staffName,
        startsAt: start,
        endsAt: end,
      });
    }
  }

  slots.sort(
    (left, right) =>
      left.startsAt.getTime() - right.startsAt.getTime() ||
      left.staffName.localeCompare(right.staffName),
  );
  return {
    closed: !anyWindow || !anyOpenBeforeAppointments,
    slots,
  };
}

export function rangesOverlap(
  leftStart: Date,
  leftEnd: Date,
  rightStart: Date,
  rightEnd: Date,
): boolean {
  return overlaps(leftStart, leftEnd, rightStart, rightEnd);
}

function candidateStarts(
  date: string,
  timeZone: string,
  durationMinutes: number,
  person: StaffDayInput,
  rules: BookingRules,
): Date[] {
  const starts: Date[] = [];
  for (const window of person.windows) {
    for (
      let minute = window.startsMinute;
      minute + durationMinutes <= window.endsMinute;
      minute += rules.slotStepMinutes
    ) {
      const start = civilDateTimeToUtc(date, minute, timeZone);
      const end = new Date(start.getTime() + durationMinutes * 60_000);
      if (person.timeOff.some((range) => overlaps(start, end, range.startsAt, range.endsAt))) {
        continue;
      }
      starts.push(start);
    }
  }
  return starts;
}

function overlaps(leftStart: Date, leftEnd: Date, rightStart: Date, rightEnd: Date): boolean {
  return leftStart < rightEnd && leftEnd > rightStart;
}

export function weekdayForDate(date: string): number {
  return weekdayIso(date);
}
