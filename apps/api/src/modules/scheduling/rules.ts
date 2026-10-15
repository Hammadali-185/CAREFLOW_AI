export const bookingRules = {
  slotStepMinutes: 15,
  minimumNoticeMinutes: 60,
  horizonDays: 60,
} as const;

export type BookingRules = typeof bookingRules;
