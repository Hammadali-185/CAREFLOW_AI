import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARE_FLOW_REQUEST_HEADER, CSRF_HEADER, type ModelIntent } from '@careflow/shared';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ModelRequestError, type ModelClient } from '../src/modules/assistant/model.js';
import { hashPassword } from '../src/modules/auth/password.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAssistantRepository } from '../src/repositories/assistant.repository.js';
import { createPrismaAuthRepository } from '../src/repositories/auth.repository.js';
import { createPrismaClient } from '../src/repositories/prisma.js';
import { createPrismaSchedulingRepository } from '../src/repositories/scheduling.repository.js';
import { createAssistantService } from '../src/services/assistant.service.js';
import { createAuthService } from '../src/services/auth.service.js';
import { createSchedulingService } from '../src/services/scheduling.service.js';
import { silentLogger } from '../src/utils/logger.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const csrfSecret = 'test-csrf-secret-that-is-long-enough';
const origin = 'http://127.0.0.1:5173';
const password = 'CorrectHorse!2026';
const fixedNow = new Date('2026-10-14T12:00:00.000Z');

let database: PGlite;
let socket: PGLiteSocketServer;
let prisma: PrismaClient;
let app: Express;
let clinicId = '';
let serviceId = '';
let model: ScriptedModel;

beforeAll(async () => {
  database = new PGlite({ extensions: { btree_gist } });
  for (const file of [
    'apps/api/prisma/migrations/20261014120000_init/migration.sql',
    'apps/api/prisma/migrations/20261014210000_domain_model/migration.sql',
    'apps/api/prisma/migrations/20261014223000_appointment_idempotency/migration.sql',
    'apps/api/prisma/migrations/20261015010000_chat_workflow_state/migration.sql',
  ]) {
    await database.exec(readFileSync(resolve(repoRoot, file), 'utf8'));
  }
  socket = new PGLiteSocketServer({ db: database, port: 55442, host: '127.0.0.1' });
  await socket.start();
  prisma = createPrismaClient(
    'postgresql://postgres:postgres@127.0.0.1:55442/postgres?sslmode=disable',
    {
      maxConnections: 1,
    },
  );
  const passwordHash = await hashPassword(password);
  const clinic = await prisma.business.create({
    data: { name: 'North Clinic', slug: 'north-assistant', timezone: 'America/New_York' },
    select: { id: true },
  });
  clinicId = clinic.id;
  const service = await prisma.service.create({
    data: { businessId: clinicId, name: 'Follow-up', durationMinutes: 20 },
    select: { id: true },
  });
  serviceId = service.id;
  const staff = await prisma.user.create({
    data: {
      email: 'staff.assistant@north.example',
      passwordHash,
      displayName: 'Hamza Qureshi',
      memberships: { create: { businessId: clinicId, role: 'staff' } },
    },
    select: { id: true },
  });
  await prisma.user.create({
    data: {
      email: 'patient.assistant@north.example',
      passwordHash,
      displayName: 'Fatima Noor',
      memberships: { create: { businessId: clinicId, role: 'patient' } },
    },
  });
  await prisma.user.create({
    data: {
      email: 'other.assistant@north.example',
      passwordHash,
      displayName: 'Other Patient',
      memberships: { create: { businessId: clinicId, role: 'patient' } },
    },
  });
  await prisma.staffAvailability.createMany({
    data: [4, 5].map((weekday) => ({
      businessId: clinicId,
      staffUserId: staff.id,
      staffRole: 'staff' as const,
      weekday,
      startsMinute: 9 * 60,
      endsMinute: 17 * 60,
    })),
  });
  model = scriptedModel();
  const auth = createAuthService({
    repository: createPrismaAuthRepository(prisma),
    csrfSecret,
    now: () => fixedNow,
  });
  const scheduling = createSchedulingService({
    repository: createPrismaSchedulingRepository(prisma),
    now: () => fixedNow,
  });
  app = createApp({
    corsOrigins: [origin],
    probe: { async ping() {} },
    logger: silentLogger,
    nodeEnv: 'test',
    auth,
    scheduling,
    assistant: createAssistantService({
      repository: createPrismaAssistantRepository(prisma),
      scheduling,
      model: model.client,
      clinicAccess: (userId, id, allowed) => auth.clinicAccess(userId, id, allowed),
      logger: silentLogger,
      now: () => fixedNow,
    }),
  });
}, 30_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await socket?.stop();
  await database?.close();
});

describe('assistant booking', () => {
  it('does not book until the patient confirms a real slot', async () => {
    const patient = await signIn('patient.assistant@north.example');
    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'tomorrow',
        timePreference: 'morning',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    const session = await openSession(patient);
    const asked = await say(patient, session, 'I need a follow-up tomorrow morning');
    expect(asked.status).toBe(200);
    expect(asked.body.outcome).toBe('slots');
    expect(asked.body.appointment).toBeNull();
    expect(asked.body.workflow.offeredSlots.length).toBeGreaterThan(0);
    expect(asked.body.workflow.confirmationState).toBe('required');
    expect(await prisma.appointment.count()).toBe(0);

    const slot = asked.body.workflow.offeredSlots[0];
    const review = await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
    expect(review.status).toBe(200);
    expect(review.body.outcome).toBe('review');
    expect(review.body.appointment).toBeNull();
    expect(review.body.messages.at(-1).body).toContain('North Clinic');
    expect(await prisma.appointment.count()).toBe(0);

    const confirmed = await confirm(patient, session);
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.outcome).toBe('booked');
    expect(confirmed.body.appointment.status).toBe('confirmed');
    expect(confirmed.body.appointment.serviceId).toBe(serviceId);
    expect(confirmed.body.appointment.startsAt).toBe(slot.startsAt);
    expect(await prisma.appointment.count({ where: { id: confirmed.body.appointment.id } })).toBe(
      1,
    );

    const replay = await confirm(patient, session);
    expect(replay.body.appointment.id).toBe(confirmed.body.appointment.id);
    expect(await prisma.appointment.count()).toBe(1);
  });

  it('keeps the service when the patient corrects only the day', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'tomorrow',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    await say(patient, session, 'Follow-up tomorrow');
    model.push(
      intent({
        intent: 'clarify',
        serviceQuery: null,
        datePreference: 'Friday',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    const corrected = await say(patient, session, 'Make it Friday instead');
    expect(corrected.body.workflow.serviceId).toBe(serviceId);
    expect(corrected.body.workflow.date).toBe('2026-10-16');
    expect(corrected.body.outcome).toBe('slots');
    expect(corrected.body.appointment).toBeNull();
  });

  it('asks for a missing service and does not invent one', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    model.push(
      intent({
        intent: 'book',
        missingFields: ['service', 'date'],
        needsClarification: true,
        proposedAction: 'ask',
        confirmationState: 'required',
      }),
    );
    const asked = await say(patient, session, 'I need an appointment');
    expect(asked.body.outcome).toBe('reply');
    expect(asked.body.workflow.offeredSlots).toEqual([]);
    expect(asked.body.messages.at(-1).body).toContain('Follow-up');
    const beforeMissing = await prisma.appointment.count();

    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'massage',
        datePreference: 'tomorrow',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    const missing = await say(patient, session, 'Book a massage tomorrow');
    expect(missing.body.appointment).toBeNull();
    expect(missing.body.messages.at(-1).body).toMatch(/does not offer/i);
    expect(missing.body.messages.at(-1).body).toContain('Follow-up');
    expect(await prisma.appointment.count()).toBe(beforeMissing);
  });

  it('rejects malformed model output and an unavailable provider', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    model.push('DROP TABLE appointments;');
    const malformed = await say(patient, session, "'; DROP TABLE appointments;--");
    expect(malformed.body.outcome).toBe('invalid_output');
    expect(malformed.body.appointment).toBeNull();
    expect(
      malformed.body.messages.some((message: { body: string }) =>
        message.body.includes('DROP TABLE'),
      ),
    ).toBe(true);
    const beforeProvider = await prisma.appointment.count();

    model.push(
      new ModelRequestError(
        'TIMEOUT',
        'The scheduling assistant took too long. You can book from the form.',
      ),
    );
    const unavailable = await say(patient, session, 'Follow-up tomorrow morning');
    expect(unavailable.body.outcome).toBe('unavailable');
    expect(unavailable.body.manualBooking).toEqual({ serviceId: null, date: null });
    expect(unavailable.body.messages.at(-1).body).toMatch(/form/i);
    expect(await prisma.appointment.count()).toBe(beforeProvider);
  });

  it('requires confirmation and refuses a slot that was not offered', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const beforeBogus = await prisma.appointment.count();
    const session = await openSession(patient);
    const early = await confirm(patient, session);
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('CONFIRMATION_REQUIRED');

    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'Friday',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    await say(patient, session, 'Follow-up on Friday');
    const bogus = await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({
        staffUserId: '22222222-2222-4222-8222-222222222222',
        startsAt: '2026-10-16T08:00:00.000Z',
      });
    expect(bogus.status).toBe(409);
    expect(bogus.body.error.code).toBe('SLOT_UNAVAILABLE');
    expect(await prisma.appointment.count()).toBe(beforeBogus);
  });

  it('blocks another patient, a staff member, and an emergency request', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const other = await signIn('other.assistant@north.example');
    const hidden = await request(app)
      .get(`/api/assistant/sessions/${session}`)
      .set('Cookie', other.cookie);
    expect(hidden.status).toBe(403);

    const staff = await signIn('staff.assistant@north.example');
    const denied = await request(app)
      .post(`/api/clinics/${clinicId}/assistant/sessions`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, staff.csrf)
      .set('Cookie', staff.cookie)
      .send({});
    expect(denied.status).toBe(403);

    const anon = await request(app).get(`/api/clinics/${clinicId}/assistant/sessions`);
    expect(anon.status).toBe(401);

    const calls = model.calls;
    const emergency = await say(patient, session, 'I have chest pain');
    expect(emergency.body.outcome).toBe('emergency');
    expect(emergency.body.appointment).toBeNull();
    expect(emergency.body.messages.at(-1).body).toMatch(/emergency/i);
    expect(model.calls).toBe(calls);
  });

  it('cancels and reschedules only after confirmation', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const before = await prisma.appointment.count();
    const session = await openSession(patient);
    model.push(
      intent({
        intent: 'cancel',
        serviceQuery: 'Follow-up',
        datePreference: 'tomorrow',
        proposedAction: 'prepare_cancel',
        confirmationState: 'required',
      }),
    );
    const prepared = await say(patient, session, 'Cancel my follow-up tomorrow');
    expect(prepared.body.outcome).toBe('review');
    expect(prepared.body.workflow.phase).toBe('awaiting_cancel_confirmation');
    expect(await prisma.appointment.count({ where: { status: 'cancelled' } })).toBe(0);

    const cancelled = await confirm(patient, session);
    expect(cancelled.body.outcome).toBe('cancelled');
    expect(cancelled.body.appointment.status).toBe('cancelled');

    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'Friday',
        timePreference: 'morning',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    const slots = await say(patient, session, 'Book a follow-up Friday morning');
    const slot = slots.body.workflow.offeredSlots[0];
    await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
    const booked = await confirm(patient, session);
    expect(booked.body.outcome).toBe('booked');

    model.push(
      intent({
        intent: 'reschedule',
        datePreference: 'tomorrow',
        timePreference: 'afternoon',
        proposedAction: 'prepare_reschedule',
        confirmationState: 'required',
      }),
    );
    const move = await say(patient, session, 'Move that visit to tomorrow afternoon');
    expect(move.body.appointment).toBeNull();
    expect(move.body.outcome).toBe('slots');
    const next = move.body.workflow.offeredSlots.at(-1);
    await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: next.staffUserId, startsAt: next.startsAt });
    const moved = await confirm(patient, session);
    expect(moved.body.outcome).toBe('rescheduled');
    expect(moved.body.appointment.startsAt).toBe(next.startsAt);
    expect(await prisma.appointment.count()).toBe(before + 2);
  });

  it('sends only a bounded history to the model', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    for (let index = 0; index < 8; index += 1) {
      model.push(intent({ intent: 'clarify', needsClarification: true, proposedAction: 'ask' }));
      await say(patient, session, `Note ${index}`);
    }
    expect(model.lastHistory).toBe(12);
  });
});

type Session = { cookie: string; csrf: string };
type ScriptedModel = {
  client: ModelClient;
  push: (value: string | ModelRequestError) => void;
  calls: number;
  lastHistory: number;
};

function scriptedModel(): ScriptedModel {
  const queue: Array<string | ModelRequestError> = [];
  const state = { calls: 0, lastHistory: 0 };
  return {
    client: {
      async complete(input) {
        state.calls += 1;
        state.lastHistory = input.messages.length;
        const next = queue.shift();
        if (next instanceof ModelRequestError) {
          throw next;
        }
        if (!next) {
          throw new Error('The test model has no scripted reply.');
        }
        return {
          content: next,
          model: 'test-model',
          promptTokens: 11,
          completionTokens: 7,
          latencyMs: 4,
        };
      },
    },
    push(value) {
      queue.push(value);
    },
    get calls() {
      return state.calls;
    },
    get lastHistory() {
      return state.lastHistory;
    },
  };
}

function intent(overrides: Partial<ModelIntent>) {
  return JSON.stringify({
    intent: 'clarify',
    serviceQuery: null,
    datePreference: null,
    timePreference: null,
    staffQuery: null,
    missingFields: [],
    needsClarification: false,
    clarificationQuestion: null,
    proposedAction: 'ask',
    confirmationState: 'not_required',
    emergency: false,
    ...overrides,
  });
}

async function signIn(email: string): Promise<Session> {
  const response = await request(app)
    .post('/api/auth/login')
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .send({ email, password });
  expect(response.status).toBe(200);
  const header = response.headers['set-cookie'];
  const values = Array.isArray(header) ? header : header ? [header] : [];
  return { cookie: values.join('; '), csrf: response.body.csrfToken as string };
}

async function openSession(patient: Session) {
  const response = await request(app)
    .post(`/api/clinics/${clinicId}/assistant/sessions`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({});
  expect(response.status).toBe(201);
  return response.body.session.id as string;
}

function say(patient: Session, sessionId: string, text: string) {
  return request(app)
    .post(`/api/assistant/sessions/${sessionId}/messages`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({ text });
}

function confirm(patient: Session, sessionId: string) {
  return request(app)
    .post(`/api/assistant/sessions/${sessionId}/confirm`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({ confirmed: true });
}
