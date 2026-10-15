import type { AppointmentRecord, AppointmentStatus, MembershipRole } from '@careflow/shared';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import { SlotTakenError, SlotUnavailableError } from '../errors/http-errors.js';
import { buildSlots, weekdayForDate } from '../modules/scheduling/slots.js';
import { addCivilDays, civilDateTimeToUtc, clinicToday } from '../modules/scheduling/time.js';

const appointmentSelect = {
  id: true,
  businessId: true,
  patientUserId: true,
  staffUserId: true,
  staffRole: true,
  serviceId: true,
  status: true,
  startsAt: true,
  endsAt: true,
  cancelledAt: true,
  idempotencyKey: true,
} satisfies Prisma.AppointmentSelect;

type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

export type StoredAppointment = AppointmentRecord & {
  patientUserId: string;
  timezone: string;
  idempotencyKey: string | null;
  staffRole: 'owner' | 'staff';
};

export type SchedulingRepository = {
  listServices(
    clinicId: string,
    activeOnly: boolean,
  ): Promise<Array<{ id: string; name: string; durationMinutes: number; active: boolean }>>;
  findService(
    clinicId: string,
    serviceId: string,
  ): Promise<{ id: string; name: string; durationMinutes: number; active: boolean } | null>;
  createService(input: {
    clinicId: string;
    name: string;
    durationMinutes: number;
  }): Promise<{ id: string; name: string; durationMinutes: number; active: boolean }>;
  updateService(
    clinicId: string,
    serviceId: string,
    input: { name?: string; durationMinutes?: number; active?: boolean },
  ): Promise<{ id: string; name: string; durationMinutes: number; active: boolean } | null>;
  listPractitioners(
    clinicId: string,
  ): Promise<Array<{ userId: string; displayName: string; role: 'owner' | 'staff' }>>;
  findPractitioner(
    clinicId: string,
    userId: string,
  ): Promise<{ userId: string; displayName: string; role: 'owner' | 'staff' } | null>;
  listWindows(
    clinicId: string,
    staffUserId: string,
    weekday: number,
  ): Promise<Array<{ startsMinute: number; endsMinute: number }>>;
  listBusy(
    clinicId: string,
    staffUserId: string,
    dayStart: Date,
    dayEnd: Date,
    excludeAppointmentId?: string,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
  listTimeOff(
    clinicId: string,
    staffUserId: string,
    dayStart: Date,
    dayEnd: Date,
  ): Promise<Array<{ startsAt: Date; endsAt: Date }>>;
  findByIdempotency(patientUserId: string, key: string): Promise<StoredAppointment | null>;
  book(input: BookInput): Promise<StoredAppointment>;
  cancel(id: string, actorUserId: string, now: Date): Promise<StoredAppointment>;
  reschedule(input: RescheduleInput): Promise<StoredAppointment>;
  listForPatient(patientUserId: string): Promise<StoredAppointment[]>;
  findById(id: string): Promise<StoredAppointment | null>;
  listSchedule(
    clinicId: string,
    staffUserId: string,
    from: Date,
    to: Date,
  ): Promise<StoredAppointment[]>;
  getAvailability(
    clinicId: string,
    staffUserId: string,
  ): Promise<{
    windows: Array<{ weekday: number; startsMinute: number; endsMinute: number }>;
    timeOff: Array<{ id: string; startsAt: Date; endsAt: Date; reason: string | null }>;
  }>;
  replaceAvailability(input: {
    clinicId: string;
    staffUserId: string;
    staffRole: 'owner' | 'staff';
    actorUserId: string;
    windows: Array<{ weekday: number; startsMinute: number; endsMinute: number }>;
  }): Promise<void>;
  createTimeOff(input: {
    clinicId: string;
    staffUserId: string;
    staffRole: 'owner' | 'staff';
    actorUserId: string;
    startsAt: Date;
    endsAt: Date;
    reason?: string;
  }): Promise<{ id: string }>;
  findTimeOff(
    clinicId: string,
    timeOffId: string,
  ): Promise<{ id: string; staffUserId: string } | null>;
  deleteTimeOff(clinicId: string, timeOffId: string): Promise<void>;
  membershipRole(clinicId: string, userId: string): Promise<MembershipRole | null>;
};

type BookInput = {
  clinicId: string;
  patientUserId: string;
  staffUserId: string;
  staffName: string;
  staffRole: 'owner' | 'staff';
  serviceId: string;
  durationMinutes: number;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  idempotencyKey: string | null;
  actorUserId: string;
  now: Date;
  excludeAppointmentId?: string;
};

type RescheduleInput = BookInput & {
  appointmentId: string;
  now: Date;
};

export function createPrismaSchedulingRepository(prisma: PrismaClient): SchedulingRepository {
  return {
    listServices(clinicId, activeOnly) {
      return prisma.service.findMany({
        where: { businessId: clinicId, ...(activeOnly ? { active: true } : {}) },
        orderBy: { name: 'asc' },
        select: { id: true, name: true, durationMinutes: true, active: true },
      });
    },
    findService(clinicId, serviceId) {
      return prisma.service.findFirst({
        where: { id: serviceId, businessId: clinicId },
        select: { id: true, name: true, durationMinutes: true, active: true },
      });
    },
    createService(input) {
      return prisma.service.create({
        data: {
          businessId: input.clinicId,
          name: input.name,
          durationMinutes: input.durationMinutes,
        },
        select: { id: true, name: true, durationMinutes: true, active: true },
      });
    },
    async updateService(clinicId, serviceId, input) {
      const existing = await prisma.service.findFirst({
        where: { id: serviceId, businessId: clinicId },
        select: { id: true },
      });
      if (!existing) {
        return null;
      }
      return prisma.service.update({
        where: { id: serviceId },
        data: input,
        select: { id: true, name: true, durationMinutes: true, active: true },
      });
    },
    async listPractitioners(clinicId) {
      const rows = await prisma.businessMembership.findMany({
        where: { businessId: clinicId, role: { in: ['owner', 'staff'] } },
        orderBy: { user: { displayName: 'asc' } },
        select: { userId: true, role: true, user: { select: { displayName: true } } },
      });
      return rows.map((row) => ({
        userId: row.userId,
        displayName: row.user.displayName,
        role: row.role as 'owner' | 'staff',
      }));
    },
    async findPractitioner(clinicId, userId) {
      const row = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: clinicId, userId } },
        select: { userId: true, role: true, user: { select: { displayName: true } } },
      });
      if (!row || (row.role !== 'owner' && row.role !== 'staff')) {
        return null;
      }
      return { userId: row.userId, displayName: row.user.displayName, role: row.role };
    },
    async listWindows(clinicId, staffUserId, weekday) {
      const rows = await prisma.staffAvailability.findMany({
        where: { businessId: clinicId, staffUserId, weekday },
        orderBy: { startsMinute: 'asc' },
        select: { startsMinute: true, endsMinute: true },
      });
      return rows;
    },
    listBusy(clinicId, staffUserId, dayStart, dayEnd, excludeAppointmentId) {
      return prisma.appointment.findMany({
        where: {
          businessId: clinicId,
          staffUserId,
          status: { in: ['requested', 'confirmed'] },
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
          ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
        },
        select: { startsAt: true, endsAt: true },
      });
    },
    listTimeOff(clinicId, staffUserId, dayStart, dayEnd) {
      return prisma.staffTimeOff.findMany({
        where: {
          businessId: clinicId,
          staffUserId,
          startsAt: { lt: dayEnd },
          endsAt: { gt: dayStart },
        },
        select: { startsAt: true, endsAt: true },
      });
    },
    async findByIdempotency(patientUserId, key) {
      const row = await prisma.appointment.findFirst({
        where: { patientUserId, idempotencyKey: key },
        select: appointmentSelect,
      });
      const [stored] = await hydrateAppointments(prisma, row ? [row] : []);
      return stored ?? null;
    },
    book(input) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, input.staffUserId);
        await assertSlotStillOpen(tx, input);
        const created = await tx.appointment.create({
          data: {
            businessId: input.clinicId,
            patientUserId: input.patientUserId,
            patientRole: 'patient',
            staffUserId: input.staffUserId,
            staffRole: input.staffRole,
            serviceId: input.serviceId,
            status: 'confirmed',
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            idempotencyKey: input.idempotencyKey,
          },
          select: appointmentSelect,
        });
        await tx.auditEvent.create({
          data: {
            businessId: input.clinicId,
            actorUserId: input.actorUserId,
            action: 'appointment_created',
            entityType: 'appointment',
            entityId: created.id,
            metadata: {
              serviceId: input.serviceId,
              staffUserId: input.staffUserId,
              startsAt: input.startsAt.toISOString(),
            },
          },
        });
        return oneAppointment(await hydrateAppointments(tx, [created]));
      });
    },
    cancel(id, actorUserId, now) {
      return prisma.$transaction(async (tx) => {
        await lockAppointment(tx, id);
        const updated = await tx.appointment.update({
          where: { id },
          data: { status: 'cancelled', cancelledAt: now },
          select: appointmentSelect,
        });
        await tx.auditEvent.create({
          data: {
            businessId: updated.businessId,
            actorUserId,
            action: 'appointment_cancelled',
            entityType: 'appointment',
            entityId: id,
            metadata: { cancelledAt: now.toISOString() },
          },
        });
        return oneAppointment(await hydrateAppointments(tx, [updated]));
      });
    },
    reschedule(input) {
      return prisma.$transaction(async (tx) => {
        await lockAppointment(tx, input.appointmentId);
        await lockUser(tx, input.staffUserId);
        await assertSlotStillOpen(tx, input);
        await tx.appointment.update({
          where: { id: input.appointmentId },
          data: { status: 'cancelled', cancelledAt: input.now },
        });
        const created = await tx.appointment.create({
          data: {
            businessId: input.clinicId,
            patientUserId: input.patientUserId,
            patientRole: 'patient',
            staffUserId: input.staffUserId,
            staffRole: input.staffRole,
            serviceId: input.serviceId,
            status: 'confirmed',
            startsAt: input.startsAt,
            endsAt: input.endsAt,
            rescheduledFromAppointmentId: input.appointmentId,
          },
          select: appointmentSelect,
        });
        await tx.auditEvent.create({
          data: {
            businessId: input.clinicId,
            actorUserId: input.actorUserId,
            action: 'appointment_rescheduled',
            entityType: 'appointment',
            entityId: created.id,
            metadata: {
              fromAppointmentId: input.appointmentId,
              startsAt: input.startsAt.toISOString(),
            },
          },
        });
        return oneAppointment(await hydrateAppointments(tx, [created]));
      });
    },
    async listForPatient(patientUserId) {
      const rows = await prisma.appointment.findMany({
        where: { patientUserId },
        orderBy: { startsAt: 'asc' },
        select: appointmentSelect,
      });
      return hydrateAppointments(prisma, rows);
    },
    async findById(id) {
      const row = await prisma.appointment.findUnique({ where: { id }, select: appointmentSelect });
      const [stored] = await hydrateAppointments(prisma, row ? [row] : []);
      return stored ?? null;
    },
    async listSchedule(clinicId, staffUserId, from, to) {
      const rows = await prisma.appointment.findMany({
        where: {
          businessId: clinicId,
          staffUserId,
          startsAt: { lt: to },
          endsAt: { gt: from },
        },
        orderBy: { startsAt: 'asc' },
        select: appointmentSelect,
      });
      return hydrateAppointments(prisma, rows);
    },
    async getAvailability(clinicId, staffUserId) {
      const windows = await prisma.staffAvailability.findMany({
        where: { businessId: clinicId, staffUserId },
        orderBy: [{ weekday: 'asc' }, { startsMinute: 'asc' }],
        select: { weekday: true, startsMinute: true, endsMinute: true },
      });
      const timeOff = await prisma.staffTimeOff.findMany({
        where: { businessId: clinicId, staffUserId, endsAt: { gt: new Date() } },
        orderBy: { startsAt: 'asc' },
        select: { id: true, startsAt: true, endsAt: true, reason: true },
      });
      return { windows, timeOff };
    },
    async replaceAvailability(input) {
      await prisma.$transaction(async (tx) => {
        await tx.staffAvailability.deleteMany({
          where: { businessId: input.clinicId, staffUserId: input.staffUserId },
        });
        if (input.windows.length > 0) {
          await tx.staffAvailability.createMany({
            data: input.windows.map((window) => ({
              businessId: input.clinicId,
              staffUserId: input.staffUserId,
              staffRole: input.staffRole,
              weekday: window.weekday,
              startsMinute: window.startsMinute,
              endsMinute: window.endsMinute,
            })),
          });
        }
        await tx.auditEvent.create({
          data: {
            businessId: input.clinicId,
            actorUserId: input.actorUserId,
            action: 'staff_availability_changed',
            entityType: 'staff_availability',
            entityId: input.staffUserId,
            metadata: { windows: input.windows.length },
          },
        });
      });
    },
    async createTimeOff(input) {
      const created = await prisma.staffTimeOff.create({
        data: {
          businessId: input.clinicId,
          staffUserId: input.staffUserId,
          staffRole: input.staffRole,
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason,
        },
        select: { id: true },
      });
      return created;
    },
    findTimeOff(clinicId, timeOffId) {
      return prisma.staffTimeOff.findFirst({
        where: { id: timeOffId, businessId: clinicId },
        select: { id: true, staffUserId: true },
      });
    },
    async deleteTimeOff(clinicId, timeOffId) {
      await prisma.staffTimeOff.deleteMany({ where: { id: timeOffId, businessId: clinicId } });
    },
    async membershipRole(clinicId, userId) {
      const row = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: clinicId, userId } },
        select: { role: true },
      });
      return row?.role ?? null;
    },
  };
}

type AppointmentReader = Prisma.TransactionClient | PrismaClient;

function oneAppointment(rows: StoredAppointment[]): StoredAppointment {
  const row = rows[0];
  if (!row) {
    throw new Error('Booked appointments keep a staff member.');
  }
  return row;
}

async function hydrateAppointments(
  db: AppointmentReader,
  rows: AppointmentRow[],
): Promise<StoredAppointment[]> {
  if (rows.length === 0) {
    return [];
  }
  const businesses = await db.business.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.businessId))] } },
    select: { id: true, name: true, timezone: true },
  });
  const services = await db.service.findMany({
    where: { id: { in: [...new Set(rows.map((row) => row.serviceId))] } },
    select: { id: true, name: true, durationMinutes: true },
  });
  const staff = await db.user.findMany({
    where: {
      id: { in: [...new Set(rows.flatMap((row) => (row.staffUserId ? [row.staffUserId] : [])))] },
    },
    select: { id: true, displayName: true },
  });
  const businessById = new Map(businesses.map((row) => [row.id, row]));
  const serviceById = new Map(services.map((row) => [row.id, row]));
  const staffById = new Map(staff.map((row) => [row.id, row]));
  return rows.map((row) => {
    const business = businessById.get(row.businessId);
    const service = serviceById.get(row.serviceId);
    const person = row.staffUserId ? staffById.get(row.staffUserId) : undefined;
    if (!business || !service || !row.staffUserId || !person || !row.staffRole) {
      throw new Error('Booked appointments keep a staff member.');
    }
    return {
      id: row.id,
      clinicId: row.businessId,
      clinicName: business.name,
      timezone: business.timezone,
      patientUserId: row.patientUserId,
      serviceId: row.serviceId,
      serviceName: service.name,
      durationMinutes: service.durationMinutes,
      staffUserId: row.staffUserId,
      staffName: person.displayName,
      staffRole: row.staffRole === 'owner' ? 'owner' : 'staff',
      status: row.status as AppointmentStatus,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      idempotencyKey: row.idempotencyKey,
    };
  });
}

async function assertSlotStillOpen(tx: Prisma.TransactionClient, input: BookInput) {
  const date = clinicToday(input.startsAt, input.timeZone);
  const dayStart = civilDateTimeToUtc(date, 0, input.timeZone);
  const dayEnd = civilDateTimeToUtc(addCivilDays(date, 1), 0, input.timeZone);
  const weekday = weekdayForDate(date);
  const windows = await tx.staffAvailability.findMany({
    where: { businessId: input.clinicId, staffUserId: input.staffUserId, weekday },
    select: { startsMinute: true, endsMinute: true },
  });
  const busy = await tx.appointment.findMany({
    where: {
      businessId: input.clinicId,
      staffUserId: input.staffUserId,
      status: { in: ['requested', 'confirmed'] },
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
      ...(input.excludeAppointmentId ? { id: { not: input.excludeAppointmentId } } : {}),
    },
    select: { startsAt: true, endsAt: true },
  });
  const timeOff = await tx.staffTimeOff.findMany({
    where: {
      businessId: input.clinicId,
      staffUserId: input.staffUserId,
      startsAt: { lt: dayEnd },
      endsAt: { gt: dayStart },
    },
    select: { startsAt: true, endsAt: true },
  });
  const { slots } = buildSlots({
    date,
    timeZone: input.timeZone,
    durationMinutes: input.durationMinutes,
    now: input.now,
    staff: [
      {
        staffUserId: input.staffUserId,
        staffName: input.staffName,
        windows,
        busy,
        timeOff,
      },
    ],
  });
  const open = slots.some(
    (slot) =>
      slot.staffUserId === input.staffUserId &&
      slot.startsAt.getTime() === input.startsAt.getTime(),
  );
  if (open) {
    return;
  }
  const taken = busy.some(
    (range) => input.startsAt < range.endsAt && input.endsAt > range.startsAt,
  );
  if (taken) {
    throw new SlotTakenError();
  }
  throw new SlotUnavailableError();
}

async function lockUser(tx: Prisma.TransactionClient, userId: string) {
  await tx.$queryRaw`SELECT "id" FROM "users" WHERE "id" = CAST(${userId} AS uuid) FOR UPDATE`;
}

async function lockAppointment(tx: Prisma.TransactionClient, appointmentId: string) {
  await tx.$queryRaw`SELECT "id" FROM "appointments" WHERE "id" = CAST(${appointmentId} AS uuid) FOR UPDATE`;
}
