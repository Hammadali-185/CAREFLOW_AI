const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isCivilDate(value: string): boolean {
  const match = datePattern.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function weekdayIso(date: string): number {
  const match = datePattern.exec(date);
  if (!match) {
    throw new Error('Expected a civil date.');
  }
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  const day = probe.getUTCDay();
  return day === 0 ? 7 : day;
}

export function addCivilDays(date: string, days: number): string {
  const match = datePattern.exec(date);
  if (!match) {
    throw new Error('Expected a civil date.');
  }
  const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  const year = probe.getUTCFullYear();
  const month = String(probe.getUTCMonth() + 1).padStart(2, '0');
  const day = String(probe.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function clinicToday(now: Date, timeZone: string): string {
  const parts = civilParts(now, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function civilDateTimeToUtc(date: string, minuteOfDay: number, timeZone: string): Date {
  const match = datePattern.exec(date);
  if (!match) {
    throw new Error('Expected a civil date.');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Math.floor(minuteOfDay / 60);
  const minute = minuteOfDay % 60;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offset = offsetMs(new Date(utcGuess), timeZone);
  let utc = utcGuess - offset;
  const corrected = offsetMs(new Date(utc), timeZone);
  if (corrected !== offset) {
    utc = utcGuess - corrected;
  }
  return new Date(utc);
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = civilParts(instant, timeZone);
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - instant.getTime();
}

function civilParts(instant: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return {
    year: pick('year'),
    month: pick('month'),
    day: pick('day'),
    hour: pick('hour') === '24' ? '00' : pick('hour'),
    minute: pick('minute'),
    second: pick('second'),
  };
}
