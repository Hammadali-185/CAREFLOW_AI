import type { AppointmentStatus } from '@careflow/shared';

const statusLabels: Record<AppointmentStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
  completed: 'Completed',
  no_show: 'No show',
};

export function appointmentStatusLabel(status: AppointmentStatus) {
  return statusLabels[status];
}

const statusTones = {
  requested: 'info',
  confirmed: 'success',
  cancelled: 'danger',
  completed: 'neutral',
  no_show: 'warning',
} as const;

export function appointmentStatusTone(status: AppointmentStatus) {
  return statusTones[status];
}

export function clinicCivilDate(timeZone: string, instant = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

export function clinicMidnightUtc(date: string, timeZone: string) {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const desired = Date.UTC(year, month - 1, day, 0, 0, 0);
  let utc = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(new Date(utc));
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value ?? '0');
    const hour = read('hour') % 24;
    const shown = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      hour,
      read('minute'),
      read('second'),
    );
    if (shown === desired) {
      break;
    }
    utc += desired - shown;
  }
  return new Date(utc);
}

export function addCivilDays(date: string, days: number) {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    return date;
  }
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + days);
  return utc.toISOString().slice(0, 10);
}

export function formatVisitTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));
}

export function createIdempotencyKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function canChangeAppointment(
  status: AppointmentStatus,
  startsAt: string,
  now = new Date(),
) {
  return (
    (status === 'requested' || status === 'confirmed') &&
    new Date(startsAt).getTime() > now.getTime()
  );
}
