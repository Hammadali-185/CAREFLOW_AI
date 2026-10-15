import { describe, expect, it } from 'vitest';
import { buildSlots, classifyDate } from '../src/modules/scheduling/slots.js';
import { civilDateTimeToUtc, clinicToday } from '../src/modules/scheduling/time.js';

describe('clinic civil time', () => {
  it('converts winter and summer clinic hours to UTC', () => {
    expect(civilDateTimeToUtc('2026-01-06', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-01-06T14:00:00.000Z',
    );
    expect(civilDateTimeToUtc('2026-07-07', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-07-07T13:00:00.000Z',
    );
  });

  it('uses the clinic calendar day, including just before midnight', () => {
    expect(clinicToday(new Date('2026-01-06T04:30:00.000Z'), 'America/New_York')).toBe(
      '2026-01-05',
    );
  });
});

describe('slot calculation', () => {
  const date = '2026-07-07';
  const timeZone = 'America/New_York';
  const now = new Date('2026-07-01T12:00:00.000Z');

  it('fits visits inside working hours and keeps back-to-back times', () => {
    const result = buildSlots({
      date,
      timeZone,
      durationMinutes: 30,
      now,
      staff: [
        {
          staffUserId: 'staff',
          staffName: 'Jordan',
          windows: [{ startsMinute: 9 * 60, endsMinute: 11 * 60 }],
          busy: [],
          timeOff: [],
        },
      ],
    });
    expect(result.closed).toBe(false);
    expect(result.slots.map((slot) => slot.startsAt.toISOString())).toEqual([
      '2026-07-07T13:00:00.000Z',
      '2026-07-07T13:15:00.000Z',
      '2026-07-07T13:30:00.000Z',
      '2026-07-07T13:45:00.000Z',
      '2026-07-07T14:00:00.000Z',
      '2026-07-07T14:15:00.000Z',
      '2026-07-07T14:30:00.000Z',
    ]);
  });

  it('removes slots blocked by a visit or time off and reports a closed day', () => {
    const blocked = buildSlots({
      date,
      timeZone,
      durationMinutes: 30,
      now,
      staff: [
        {
          staffUserId: 'staff',
          staffName: 'Jordan',
          windows: [{ startsMinute: 9 * 60, endsMinute: 10 * 60 }],
          busy: [],
          timeOff: [
            {
              startsAt: new Date('2026-07-07T13:00:00.000Z'),
              endsAt: new Date('2026-07-07T14:00:00.000Z'),
            },
          ],
        },
      ],
    });
    expect(blocked.slots).toEqual([]);
    expect(blocked.closed).toBe(true);

    const appointmentOnly = buildSlots({
      date,
      timeZone,
      durationMinutes: 30,
      now,
      staff: [
        {
          staffUserId: 'staff',
          staffName: 'Jordan',
          windows: [{ startsMinute: 9 * 60, endsMinute: 10 * 60 }],
          busy: [
            {
              startsAt: new Date('2026-07-07T13:00:00.000Z'),
              endsAt: new Date('2026-07-07T14:00:00.000Z'),
            },
          ],
          timeOff: [],
        },
      ],
    });
    expect(appointmentOnly.closed).toBe(false);
    expect(appointmentOnly.slots).toEqual([]);
  });

  it('rejects dates outside the booking window', () => {
    expect(classifyDate('2026-02-31', now, timeZone)).toEqual({ ok: false, reason: 'invalid' });
    expect(classifyDate('2026-06-01', now, timeZone)).toEqual({ ok: false, reason: 'outside' });
    expect(classifyDate('2026-07-07', now, timeZone)).toEqual({ ok: true });
  });
});
