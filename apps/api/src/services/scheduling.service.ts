import type {
  AppointmentRecord,
  AvailabilityWindow,
  CreateAppointmentRequest,
  CreateServiceRequest,
  CreateTimeOffRequest,
  MembershipRole,
  ReplaceAvailabilityRequest,
  RescheduleAppointmentRequest,
  UpdateServiceRequest,
} from '@careflow/shared';
import { AppError, NotFoundError } from '../errors/app-error.js';
import {
  AppointmentNotEligibleError,
  ForbiddenError,
  IdempotencyMismatchError,
  OutsideBookingWindowError,
  SlotTakenError,
  SlotUnavailableError,
} from '../errors/http-errors.js';
import {
  isIdempotencyConflict,
  isOverlapConflict,
  isUniqueConflict,
} from '../modules/scheduling/conflicts.js';
import { bookingRules } from '../modules/scheduling/rules.js';
import {
  buildSlots,
  classifyDate,
  weekdayForDate,
  type StaffDayInput,
} from '../modules/scheduling/slots.js';
import { addCivilDays, civilDateTimeToUtc, clinicToday } from '../modules/scheduling/time.js';
import type {
  SchedulingRepository,
  StoredAppointment,
} from '../repositories/scheduling.repository.js';

const idempotencyPattern = /^[A-Za-z0-9_-]{8,80}$/;

export type SchedulingService = {
  listServices(clinicId: string, role: MembershipRole): Promise<AppointmentListServices>;
  createService(clinicId: string, input: CreateServiceRequest): Promise<ServiceShape>;
  updateService(
    clinicId: string,
    serviceId: string,
    input: UpdateServiceRequest,
  ): Promise<ServiceShape>;
  listStaff(
    clinicId: string,
  ): Promise<Array<{ userId: string; displayName: string; role: 'owner' | 'staff' }>>;
  searchSlots(input: {
    clinicId: string;
    timeZone: string;
    serviceId: string;
    date: string;
    staffUserId?: string;
  }): Promise<{ date: string; timezone: string; closed: boolean; slots: SlotShape[] }>;
  createAppointment(input: {
    clinicId: string;
    timeZone: string;
    actorUserId: string;
    body: CreateAppointmentRequest;
    idempotencyKey: string | undefined;
  }): Promise<{ appointment: AppointmentRecord; replayed: boolean }>;
  listMine(actorUserId: string): Promise<AppointmentRecord[]>;
  getAppointment(actorUserId: string, appointmentId: string): Promise<AppointmentRecord>;
  cancel(actorUserId: string, appointmentId: string): Promise<AppointmentRecord>;
  reschedule(
    actorUserId: string,
    appointmentId: string,
    body: RescheduleAppointmentRequest,
  ): Promise<AppointmentRecord>;
  schedule(input: {
    clinicId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    staffUserId: string;
    from: string;
    to: string;
  }): Promise<{ staffUserId: string; appointments: AppointmentRecord[] }>;
  getAvailability(input: {
    clinicId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    staffUserId: string;
  }): Promise<{
    staffUserId: string;
    windows: AvailabilityWindow[];
    timeOff: Array<{ id: string; startsAt: string; endsAt: string; reason: string | null }>;
  }>;
  replaceAvailability(input: {
    clinicId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    staffUserId: string;
    body: ReplaceAvailabilityRequest;
  }): Promise<void>;
  createTimeOff(input: {
    clinicId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    staffUserId: string;
    body: CreateTimeOffRequest;
  }): Promise<{ id: string }>;
  deleteTimeOff(input: {
    clinicId: string;
    actorUserId: string;
    actorRole: MembershipRole;
    timeOffId: string;
  }): Promise<void>;
};

type ServiceShape = { id: string; name: string; durationMinutes: number; active: boolean };
type AppointmentListServices = { services: ServiceShape[] };
type SlotShape = { staffUserId: string; staffName: string; startsAt: string; endsAt: string };

export function createSchedulingService(deps: {
  repository: SchedulingRepository;
  now?: () => Date;
}): SchedulingService {
  const now = deps.now ?? (() => new Date());
  const repository = deps.repository;

  return {
    async listServices(clinicId, role) {
      const services = await repository.listServices(clinicId, role === 'patient');
      return { services };
    },
    async createService(clinicId, input) {
      try {
        return await repository.createService({ clinicId, ...input });
      } catch (error) {
        if (isUniqueConflict(error)) {
          throw new AppError(409, 'SERVICE_EXISTS', 'A service with that name already exists.');
        }
        throw error;
      }
    },
    async updateService(clinicId, serviceId, input) {
      const updated = await repository.updateService(clinicId, serviceId, input);
      if (!updated) {
        throw new NotFoundError('That service was not found.');
      }
      return updated;
    },
    listStaff(clinicId) {
      return repository.listPractitioners(clinicId);
    },
    async searchSlots(input) {
      const classified = classifyDate(input.date, now(), input.timeZone);
      if (!classified.ok && classified.reason === 'invalid') {
        throw new AppError(400, 'VALIDATION_ERROR', 'Enter a real calendar date.');
      }
      if (!classified.ok) {
        throw new OutsideBookingWindowError();
      }
      const service = await requireActiveService(repository, input.clinicId, input.serviceId);
      const staff = await staffForSearch(repository, input.clinicId, input.staffUserId);
      const dayStart = civilDateTimeToUtc(input.date, 0, input.timeZone);
      const dayEnd = civilDateTimeToUtc(addCivilDays(input.date, 1), 0, input.timeZone);
      const weekday = weekdayForDate(input.date);
      const people: StaffDayInput[] = [];
      for (const person of staff) {
        const windows = await repository.listWindows(input.clinicId, person.userId, weekday);
        const busy = await repository.listBusy(input.clinicId, person.userId, dayStart, dayEnd);
        const timeOff = await repository.listTimeOff(
          input.clinicId,
          person.userId,
          dayStart,
          dayEnd,
        );
        people.push({
          staffUserId: person.userId,
          staffName: person.displayName,
          windows,
          busy,
          timeOff,
        });
      }
      const built = buildSlots({
        date: input.date,
        timeZone: input.timeZone,
        durationMinutes: service.durationMinutes,
        now: now(),
        staff: people,
      });
      return {
        date: input.date,
        timezone: input.timeZone,
        closed: built.closed,
        slots: built.slots.map((slot) => ({
          staffUserId: slot.staffUserId,
          staffName: slot.staffName,
          startsAt: slot.startsAt.toISOString(),
          endsAt: slot.endsAt.toISOString(),
        })),
      };
    },
    async createAppointment(input) {
      const key = readIdempotencyKey(input.idempotencyKey);
      const startsAt = parseInstant(input.body.startsAt);
      const service = await requireActiveService(repository, input.clinicId, input.body.serviceId);
      const staff = await requirePractitioner(repository, input.clinicId, input.body.staffUserId);
      if (staff.userId === input.actorUserId) {
        throw new SlotUnavailableError();
      }
      if (key) {
        const existing = await repository.findByIdempotency(input.actorUserId, key);
        if (existing) {
          return replay(existing, input.clinicId, input.body, startsAt);
        }
      }
      const endsAt = new Date(startsAt.getTime() + service.durationMinutes * 60_000);
      try {
        const booked = await repository.book({
          clinicId: input.clinicId,
          patientUserId: input.actorUserId,
          staffUserId: staff.userId,
          staffName: staff.displayName,
          staffRole: staff.role,
          serviceId: service.id,
          durationMinutes: service.durationMinutes,
          timeZone: input.timeZone,
          startsAt,
          endsAt,
          idempotencyKey: key,
          actorUserId: input.actorUserId,
          now: now(),
          patientContactName: input.body.patientContactName,
          patientPhone: input.body.patientPhone,
        });
        return { appointment: toPublic(booked), replayed: false };
      } catch (error) {
        if (error instanceof SlotTakenError || error instanceof SlotUnavailableError) {
          throw error;
        }
        if (isOverlapConflict(error)) {
          throw new SlotTakenError();
        }
        if (key && isIdempotencyConflict(error)) {
          const existing = await repository.findByIdempotency(input.actorUserId, key);
          if (existing) {
            return replay(existing, input.clinicId, input.body, startsAt);
          }
        }
        throw error;
      }
    },
    async listMine(actorUserId) {
      const rows = await repository.listForPatient(actorUserId);
      return rows.map(toPublic);
    },
    async getAppointment(actorUserId, appointmentId) {
      return toPublic(
        await requireEditableAccess(repository, actorUserId, appointmentId, now(), false),
      );
    },
    async cancel(actorUserId, appointmentId) {
      const current = await requireAppointmentAccess(repository, actorUserId, appointmentId);
      if (current.status === 'cancelled') {
        return toPublic(current);
      }
      if (!isChangeable(current, now())) {
        throw new AppointmentNotEligibleError();
      }
      const cancelled = await repository.cancel(current.id, actorUserId, now());
      return toPublic(cancelled);
    },
    async reschedule(actorUserId, appointmentId, body) {
      const current = await requireAppointmentAccess(repository, actorUserId, appointmentId);
      const startsAt = parseInstant(body.startsAt);
      if (current.status === 'cancelled') {
        const moved = await repository.findRescheduledFrom(current.id);
        if (moved) {
          return toPublic(moved);
        }
        throw new AppointmentNotEligibleError();
      }
      if (!isChangeable(current, now())) {
        throw new AppointmentNotEligibleError();
      }
      const staff = await requirePractitioner(repository, current.clinicId, body.staffUserId);
      if (staff.userId === current.patientUserId) {
        throw new SlotUnavailableError();
      }
      const endsAt = new Date(startsAt.getTime() + current.durationMinutes * 60_000);
      try {
        const moved = await repository.reschedule({
          appointmentId: current.id,
          clinicId: current.clinicId,
          patientUserId: current.patientUserId,
          staffUserId: staff.userId,
          staffName: staff.displayName,
          staffRole: staff.role,
          serviceId: current.serviceId,
          durationMinutes: current.durationMinutes,
          timeZone: current.timezone,
          startsAt,
          endsAt,
          idempotencyKey: null,
          actorUserId,
          now: now(),
          excludeAppointmentId: current.id,
          patientContactName: current.patientContactName,
          patientPhone: current.patientPhone,
        });
        return toPublic(moved);
      } catch (error) {
        if (error instanceof SlotTakenError || error instanceof SlotUnavailableError) {
          throw error;
        }
        if (error instanceof AppointmentNotEligibleError) {
          const moved = await repository.findRescheduledFrom(current.id);
          if (moved) {
            return toPublic(moved);
          }
          throw error;
        }
        if (isOverlapConflict(error)) {
          throw new SlotTakenError();
        }
        throw error;
      }
    },
    async schedule(input) {
      await assertScheduleAccess(repository, input);
      const from = parseInstant(input.from);
      const to = parseInstant(input.to);
      if (to <= from) {
        throw new OutsideBookingWindowError();
      }
      const rows = await repository.listSchedule(input.clinicId, input.staffUserId, from, to);
      return { staffUserId: input.staffUserId, appointments: rows.map(toPublic) };
    },
    async getAvailability(input) {
      await assertScheduleAccess(repository, input);
      const availability = await repository.getAvailability(input.clinicId, input.staffUserId);
      return {
        staffUserId: input.staffUserId,
        windows: availability.windows,
        timeOff: availability.timeOff.map((row) => ({
          id: row.id,
          startsAt: row.startsAt.toISOString(),
          endsAt: row.endsAt.toISOString(),
          reason: row.reason,
        })),
      };
    },
    async replaceAvailability(input) {
      const staff = await assertSelfOrOwner(repository, input);
      assertWindows(input.body.windows);
      try {
        await repository.replaceAvailability({
          clinicId: input.clinicId,
          staffUserId: staff.userId,
          staffRole: staff.role,
          actorUserId: input.actorUserId,
          windows: input.body.windows,
        });
      } catch (error) {
        if (isOverlapConflict(error)) {
          throw new SlotUnavailableError();
        }
        throw error;
      }
    },
    async createTimeOff(input) {
      const staff = await assertSelfOrOwner(repository, input);
      const startsAt = parseInstant(input.body.startsAt);
      const endsAt = parseInstant(input.body.endsAt);
      if (endsAt <= startsAt) {
        throw new OutsideBookingWindowError();
      }
      return repository.createTimeOff({
        clinicId: input.clinicId,
        staffUserId: staff.userId,
        staffRole: staff.role,
        actorUserId: input.actorUserId,
        startsAt,
        endsAt,
        reason: input.body.reason,
      });
    },
    async deleteTimeOff(input) {
      const existing = await repository.findTimeOff(input.clinicId, input.timeOffId);
      if (!existing) {
        throw new NotFoundError('That time off was not found.');
      }
      await assertSelfOrOwner(repository, {
        clinicId: input.clinicId,
        actorUserId: input.actorUserId,
        actorRole: input.actorRole,
        staffUserId: existing.staffUserId,
      });
      await repository.deleteTimeOff(input.clinicId, input.timeOffId);
    },
  };
}

function toPublic(row: StoredAppointment): AppointmentRecord {
  return {
    id: row.id,
    clinicId: row.clinicId,
    clinicName: row.clinicName,
    serviceId: row.serviceId,
    serviceName: row.serviceName,
    durationMinutes: row.durationMinutes,
    staffUserId: row.staffUserId,
    staffName: row.staffName,
    status: row.status,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    cancelledAt: row.cancelledAt,
    patientContactName: row.patientContactName,
    patientPhone: row.patientPhone,
  };
}

function replay(
  existing: StoredAppointment,
  clinicId: string,
  body: CreateAppointmentRequest,
  startsAt: Date,
) {
  const same =
    existing.clinicId === clinicId &&
    existing.serviceId === body.serviceId &&
    existing.staffUserId === body.staffUserId &&
    new Date(existing.startsAt).getTime() === startsAt.getTime();
  if (!same) {
    throw new IdempotencyMismatchError();
  }
  return { appointment: toPublic(existing), replayed: true };
}

async function requireActiveService(
  repository: SchedulingRepository,
  clinicId: string,
  serviceId: string,
) {
  const service = await repository.findService(clinicId, serviceId);
  if (!service || !service.active) {
    throw new NotFoundError('That service was not found.');
  }
  return service;
}

async function requirePractitioner(
  repository: SchedulingRepository,
  clinicId: string,
  userId: string,
) {
  const staff = await repository.findPractitioner(clinicId, userId);
  if (!staff) {
    throw new ForbiddenError();
  }
  return staff;
}

async function staffForSearch(
  repository: SchedulingRepository,
  clinicId: string,
  staffUserId: string | undefined,
) {
  if (!staffUserId) {
    return repository.listPractitioners(clinicId);
  }
  const staff = await repository.findPractitioner(clinicId, staffUserId);
  if (!staff) {
    throw new ForbiddenError();
  }
  return [staff];
}

async function requireEditableAccess(
  repository: SchedulingRepository,
  actorUserId: string,
  appointmentId: string,
  instant: Date,
  mustBeChangeable: boolean,
) {
  const appointment = await requireAppointmentAccess(repository, actorUserId, appointmentId);
  if (mustBeChangeable && !isChangeable(appointment, instant)) {
    throw new AppointmentNotEligibleError();
  }
  return appointment;
}

async function requireAppointmentAccess(
  repository: SchedulingRepository,
  actorUserId: string,
  appointmentId: string,
) {
  const appointment = await repository.findById(appointmentId);
  if (!appointment) {
    throw new NotFoundError('That appointment was not found.');
  }
  const role = await repository.membershipRole(appointment.clinicId, actorUserId);
  const isPatient = appointment.patientUserId === actorUserId;
  const isStaff = role === 'owner' || role === 'staff';
  if (!isPatient && !isStaff) {
    throw new ForbiddenError();
  }
  return appointment;
}

function isChangeable(appointment: StoredAppointment, instant: Date) {
  return (
    (appointment.status === 'requested' || appointment.status === 'confirmed') &&
    new Date(appointment.startsAt).getTime() > instant.getTime()
  );
}

async function assertScheduleAccess(
  repository: SchedulingRepository,
  input: { clinicId: string; actorUserId: string; actorRole: MembershipRole; staffUserId: string },
) {
  if (input.actorRole === 'owner') {
    const staff = await repository.findPractitioner(input.clinicId, input.staffUserId);
    if (!staff) {
      throw new ForbiddenError();
    }
    return;
  }
  if (input.actorUserId !== input.staffUserId || input.actorRole !== 'staff') {
    throw new ForbiddenError();
  }
}

async function assertSelfOrOwner(
  repository: SchedulingRepository,
  input: { clinicId: string; actorUserId: string; actorRole: MembershipRole; staffUserId: string },
) {
  if (input.actorRole !== 'owner' && input.actorUserId !== input.staffUserId) {
    throw new ForbiddenError();
  }
  return requirePractitioner(repository, input.clinicId, input.staffUserId);
}

function assertWindows(windows: AvailabilityWindow[]) {
  const byDay = new Map<number, AvailabilityWindow[]>();
  for (const window of windows) {
    if (window.endsMinute <= window.startsMinute) {
      throw new SlotUnavailableError();
    }
    const day = byDay.get(window.weekday) ?? [];
    day.push(window);
    byDay.set(window.weekday, day);
  }
  for (const day of byDay.values()) {
    const ordered = [...day].sort((left, right) => left.startsMinute - right.startsMinute);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (previous && current && current.startsMinute < previous.endsMinute) {
        throw new SlotUnavailableError();
      }
    }
  }
}

function readIdempotencyKey(value: string | undefined) {
  if (value === undefined || value === '') {
    return null;
  }
  if (!idempotencyPattern.test(value)) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Use a booking key of 8 to 80 letters, numbers, _ or -.',
    );
  }
  return value;
}

function parseInstant(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new OutsideBookingWindowError();
  }
  return parsed;
}

export { bookingRules, clinicToday };
