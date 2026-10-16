import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARE_FLOW_REQUEST_HEADER, CSRF_HEADER, IDEMPOTENCY_HEADER } from '@careflow/shared';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/modules/auth/password.js';
import { createApp } from '../src/app.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAuthRepository } from '../src/repositories/auth.repository.js';
import { createPrismaClient } from '../src/repositories/prisma.js';
import { createPrismaSchedulingRepository } from '../src/repositories/scheduling.repository.js';
import { createAuthService } from '../src/services/auth.service.js';
import { createSchedulingService } from '../src/services/scheduling.service.js';
import { silentLogger } from '../src/utils/logger.js';
import { unusedAssistant } from './unused-assistant.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const csrfSecret = 'test-csrf-secret-that-is-long-enough';
const origin = 'http://127.0.0.1:5173';
const password = 'CorrectHorse!2026';

let database: PGlite;
let socket: PGLiteSocketServer;
let prisma: PrismaClient;
let app: Express;
let clinicId = '';
let otherClinicId = '';
let serviceId = '';
let staffId = '';
let ownerId = '';
let patientId = '';
let otherPatientId = '';

beforeAll(async () => {
  database = new PGlite({ extensions: { btree_gist } });
  await database.exec(
    readFileSync(
      resolve(repoRoot, 'apps/api/prisma/migrations/20261014120000_init/migration.sql'),
      'utf8',
    ),
  );
  await database.exec(
    readFileSync(
      resolve(repoRoot, 'apps/api/prisma/migrations/20261014210000_domain_model/migration.sql'),
      'utf8',
    ),
  );
  await database.exec(
    readFileSync(
      resolve(
        repoRoot,
        'apps/api/prisma/migrations/20261014223000_appointment_idempotency/migration.sql',
      ),
      'utf8',
    ),
  );
  await database.exec(
    readFileSync(
      resolve(repoRoot, 'apps/api/prisma/migrations/20261016190000_appointment_contact/migration.sql'),
      'utf8',
    ),
  );
  socket = new PGLiteSocketServer({ db: database, port: 55443, host: '127.0.0.1' });
  await socket.start();
  prisma = createPrismaClient(
    'postgresql://postgres:postgres@127.0.0.1:55443/postgres?sslmode=disable',
    { maxConnections: 1 },
  );
  const passwordHash = await hashPassword(password);
  const clinic = await prisma.business.create({
    data: { name: 'North Clinic', slug: 'north-book', timezone: 'America/New_York' },
    select: { id: true },
  });
  const other = await prisma.business.create({
    data: { name: 'South Clinic', slug: 'south-book', timezone: 'America/Chicago' },
    select: { id: true },
  });
  clinicId = clinic.id;
  otherClinicId = other.id;
  const service = await prisma.service.create({
    data: { businessId: clinicId, name: 'Follow-up', durationMinutes: 30 },
    select: { id: true },
  });
  serviceId = service.id;
  const owner = await prisma.user.create({
    data: {
      email: 'owner.book@north.example',
      passwordHash,
      displayName: 'Olivia Owner',
      memberships: { create: { businessId: clinicId, role: 'owner' } },
    },
    select: { id: true },
  });
  const staff = await prisma.user.create({
    data: {
      email: 'staff.book@north.example',
      passwordHash,
      displayName: 'Sam Staff',
      memberships: { create: { businessId: clinicId, role: 'staff' } },
    },
    select: { id: true },
  });
  const patient = await prisma.user.create({
    data: {
      email: 'patient.book@north.example',
      passwordHash,
      displayName: 'Pat Patient',
      memberships: { create: { businessId: clinicId, role: 'patient' } },
    },
    select: { id: true },
  });
  const otherPatient = await prisma.user.create({
    data: {
      email: 'other.book@north.example',
      passwordHash,
      displayName: 'Olivia Other',
      memberships: {
        create: [
          { businessId: clinicId, role: 'patient' },
          { businessId: otherClinicId, role: 'patient' },
        ],
      },
    },
    select: { id: true },
  });
  ownerId = owner.id;
  staffId = staff.id;
  patientId = patient.id;
  otherPatientId = otherPatient.id;
  const tuesday = upcomingWeekday(2);
  await prisma.staffAvailability.create({
    data: {
      businessId: clinicId,
      staffUserId: staffId,
      staffRole: 'staff',
      weekday: weekdayNumber(tuesday),
      startsMinute: 9 * 60,
      endsMinute: 12 * 60,
    },
  });
  app = createApp({
    corsOrigins: [origin],
    probe: { async ping() {} },
    logger: silentLogger,
    nodeEnv: 'test',
    authRateLimit: { limit: 100, windowMs: 60_000 },
    auth: createAuthService({
      repository: createPrismaAuthRepository(prisma),
      csrfSecret,
    }),
    scheduling: createSchedulingService({
      repository: createPrismaSchedulingRepository(prisma),
    }),
    assistant: unusedAssistant,
  });
}, 30_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await socket?.stop();
  await database?.close();
});

describe('appointment booking', () => {
  it('lists open slots and rejects an invalid or closed day', async () => {
    const patient = await signIn('patient.book@north.example');
    const tuesday = upcomingWeekday(2);
    const slots = await request(app)
      .get(`/api/clinics/${clinicId}/slots`)
      .query({ serviceId, date: tuesday })
      .set('Cookie', patient.cookie);
    expect(slots.status).toBe(200);
    expect(slots.body.closed).toBe(false);
    expect(slots.body.slots.length).toBeGreaterThan(1);
    expect(slots.body.slots[0].staffUserId).toBe(staffId);

    const invalid = await request(app)
      .get(`/api/clinics/${clinicId}/slots`)
      .query({ serviceId, date: '2026-02-31' })
      .set('Cookie', patient.cookie);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');

    const sunday = upcomingWeekday(7);
    const closed = await request(app)
      .get(`/api/clinics/${clinicId}/slots`)
      .query({ serviceId, date: sunday })
      .set('Cookie', patient.cookie);
    expect(closed.status).toBe(200);
    expect(closed.body.closed).toBe(true);
    expect(closed.body.slots).toEqual([]);

    const foreign = await request(app)
      .get(`/api/clinics/${otherClinicId}/services`)
      .set('Cookie', patient.cookie);
    expect(foreign.status).toBe(403);
    expect(foreign.body.error.code).toBe('FORBIDDEN');
  });

  it('books a slot, rejects a second patient, and replays the same idempotency key', async () => {
    const patient = await signIn('patient.book@north.example');
    const slot = await firstOpenSlot(patient.cookie);
    const key = 'booking-key-patient-001';
    const created = await book(patient, slot, key);
    expect(created.status).toBe(201);
    expect(created.body.replayed).toBe(false);
    expect(created.body.appointment.status).toBe('confirmed');

    const replay = await book(patient, slot, key);
    expect(replay.status).toBe(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.appointment.id).toBe(created.body.appointment.id);

    const mismatch = await book(patient, { ...slot, startsAt: '2026-08-01T15:00:00.000Z' }, key);
    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error.code).toBe('IDEMPOTENCY_MISMATCH');

    const other = await signIn('other.book@north.example');
    const taken = await book(other, slot);
    expect(taken.status).toBe(409);
    expect(taken.body.error.code).toBe('SLOT_TAKEN');

    const rows = await prisma.appointment.count({
      where: { staffUserId: staffId, startsAt: new Date(slot.startsAt), status: 'confirmed' },
    });
    expect(rows).toBe(1);
    expect(patientId).not.toBe(otherPatientId);
  });

  it('lets only one of two concurrent bookings commit', async () => {
    const patient = await signIn('patient.book@north.example');
    const other = await signIn('other.book@north.example');
    const slot = await firstOpenSlot(patient.cookie);
    const [first, second] = await Promise.all([book(patient, slot), book(other, slot)]);
    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = first.status === 201 ? first : second;
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('SLOT_TAKEN');
    expect(winner.body.appointment.staffUserId).toBe(staffId);
  });

  it('cancels only the patient who owns the visit and keeps a failed reschedule', async () => {
    const patient = await signIn('patient.book@north.example');
    const other = await signIn('other.book@north.example');
    const firstSlot = await firstOpenSlot(patient.cookie);
    const created = await book(patient, firstSlot);
    expect(created.status).toBe(201);
    const secondSlot = await firstOpenSlot(patient.cookie);
    const neighbor = await book(patient, secondSlot);
    expect(neighbor.status).toBe(201);

    const denied = await request(app)
      .post(`/api/appointments/${created.body.appointment.id}/cancel`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, other.csrf)
      .set('Cookie', other.cookie);
    expect(denied.status).toBe(403);

    const clash = await request(app)
      .post(`/api/appointments/${created.body.appointment.id}/reschedule`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: staffId, startsAt: secondSlot.startsAt });
    expect(clash.status).toBe(409);
    const unchanged = await prisma.appointment.findUnique({
      where: { id: created.body.appointment.id },
      select: { status: true, startsAt: true },
    });
    expect(unchanged?.status).toBe('confirmed');
    expect(unchanged?.startsAt.toISOString()).toBe(firstSlot.startsAt);

    const third = await firstOpenSlot(patient.cookie);
    const moved = await request(app)
      .post(`/api/appointments/${created.body.appointment.id}/reschedule`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: staffId, startsAt: third.startsAt });
    expect(moved.status).toBe(200);
    expect(moved.body.appointment.startsAt).toBe(third.startsAt);
    const original = await prisma.appointment.findUnique({
      where: { id: created.body.appointment.id },
      select: { status: true },
    });
    expect(original?.status).toBe('cancelled');

    const cancelled = await request(app)
      .post(`/api/appointments/${neighbor.body.appointment.id}/cancel`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.appointment.status).toBe('cancelled');
  });

  it('hides another clinic schedule from staff and lets the clinic administrator manage services', async () => {
    const patient = await signIn('patient.book@north.example');
    const staff = await signIn('staff.book@north.example');
    const owner = await signIn('owner.book@north.example');
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 70 * 24 * 60 * 60 * 1000).toISOString();

    const own = await request(app)
      .get(`/api/clinics/${clinicId}/staff/${staffId}/schedule`)
      .query({ from, to })
      .set('Cookie', staff.cookie);
    expect(own.status).toBe(200);

    const denied = await request(app)
      .get(`/api/clinics/${clinicId}/staff/${ownerId}/schedule`)
      .query({ from, to })
      .set('Cookie', staff.cookie);
    expect(denied.status).toBe(403);

    const admin = await request(app)
      .get(`/api/clinics/${clinicId}/staff/${staffId}/schedule`)
      .query({ from, to })
      .set('Cookie', owner.cookie);
    expect(admin.status).toBe(200);

    const patientWrite = await request(app)
      .post(`/api/clinics/${clinicId}/services`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ name: 'Patient invented visit', durationMinutes: 20 });
    expect(patientWrite.status).toBe(403);

    const created = await request(app)
      .post(`/api/clinics/${clinicId}/services`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, staff.csrf)
      .set('Cookie', staff.cookie)
      .send({ name: 'Blood pressure check', durationMinutes: 15 });
    expect(created.status).toBe(201);

    const mine = await request(app).get('/api/appointments').set('Cookie', patient.cookie);
    expect(mine.status).toBe(200);
    expect(
      mine.body.appointments.every((row: { clinicId: string }) => row.clinicId === clinicId),
    ).toBe(true);
    expect(JSON.stringify(mine.body)).not.toMatch(/passwordHash|idempotencyKey/);
  });
});

type Session = { cookie: string; csrf: string };
type Slot = { staffUserId: string; startsAt: string; endsAt: string };

async function signIn(email: string): Promise<Session> {
  const response = await request(app)
    .post('/api/auth/login')
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .send({ email, password });
  expect(response.status).toBe(200);
  return { cookie: cookieHeader(response.headers['set-cookie']), csrf: response.body.csrfToken };
}

async function firstOpenSlot(cookie: string): Promise<Slot> {
  const tuesday = upcomingWeekday(2);
  const response = await request(app)
    .get(`/api/clinics/${clinicId}/slots`)
    .query({ serviceId, date: tuesday, staffUserId: staffId })
    .set('Cookie', cookie);
  expect(response.status).toBe(200);
  const slot = response.body.slots[0] as Slot | undefined;
  if (!slot) {
    throw new Error('Expected an open slot.');
  }
  return slot;
}

function book(session: Session, slot: Slot, key?: string) {
  const call = request(app)
    .post(`/api/clinics/${clinicId}/appointments`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, session.csrf)
    .set('Cookie', session.cookie)
    .send({
      serviceId,
      staffUserId: slot.staffUserId,
      startsAt: slot.startsAt,
      patientContactName: 'Fatima Noor',
      patientPhone: '555-010-2345',
    });
  return key ? call.set(IDEMPOTENCY_HEADER, key) : call;
}

function upcomingWeekday(isoWeekday: number) {
  const start = new Date();
  for (let offset = 2; offset < 50; offset += 1) {
    const probe = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + offset),
    );
    if (weekdayNumber(probe.toISOString().slice(0, 10)) === isoWeekday) {
      return probe.toISOString().slice(0, 10);
    }
  }
  throw new Error('No matching weekday.');
}

function weekdayNumber(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const probe = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1));
  const value = probe.getUTCDay();
  return value === 0 ? 7 : value;
}

function cookieHeader(header: string | string[] | undefined) {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  if (values.length === 0) {
    throw new Error('Session cookie was not set.');
  }
  return values.join('; ');
}
