import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARE_FLOW_REQUEST_HEADER, CSRF_HEADER, type ModelIntent } from '@careflow/shared';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ModelRequestError, type ModelClient } from '../src/modules/assistant/model.js';
import { hashPassword } from '../src/modules/auth/password.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createPrismaAssistantRepository } from '../src/repositories/assistant.repository.js';
import { createPrismaAuthRepository } from '../src/repositories/auth.repository.js';
import { createPrismaClient } from '../src/repositories/prisma.js';
import { createPrismaSchedulingRepository } from '../src/repositories/scheduling.repository.js';
import { TURN_CLAIM_TTL_MS, createAssistantService } from '../src/services/assistant.service.js';
import { createAuthService } from '../src/services/auth.service.js';
import { createSchedulingService } from '../src/services/scheduling.service.js';
import { silentLogger } from '../src/utils/logger.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const csrfSecret = 'test-csrf-secret-that-is-long-enough';
const origin = 'http://127.0.0.1:5173';
const password = 'CorrectHorse!2026';
const fixedNow = new Date('2026-10-14T12:00:00.000Z');
let assistantNow = fixedNow;
const turnHooks: {
  onTurnWait: (() => void) | null;
  beforeTurnPersist: (() => Promise<void>) | null;
  beforeWorkflowSave: (() => Promise<void>) | null;
} = {
  onTurnWait: null,
  beforeTurnPersist: null,
  beforeWorkflowSave: null,
};

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
    authRateLimit: { limit: 100, windowMs: 15 * 60 * 1000 },
    auth,
    scheduling,
    assistant: createAssistantService({
      repository: createPrismaAssistantRepository(prisma),
      scheduling,
      model: model.client,
      clinicAccess: (userId, id, allowed) => auth.clinicAccess(userId, id, allowed),
      logger: silentLogger,
      now: () => assistantNow,
      onTurnWait: () => turnHooks.onTurnWait?.(),
      beforeTurnPersist: () => turnHooks.beforeTurnPersist?.() ?? Promise.resolve(),
      beforeWorkflowSave: () => turnHooks.beforeWorkflowSave?.() ?? Promise.resolve(),
    }),
  });
}, 30_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await socket?.stop();
  await database?.close();
});

afterEach(() => {
  assistantNow = fixedNow;
  turnHooks.onTurnWait = null;
  turnHooks.beforeTurnPersist = null;
  turnHooks.beforeWorkflowSave = null;
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

  it('answers a greeting and an exact catalog selection without the model', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const calls = model.calls;
    const greeted = await say(patient, session, 'hi');
    expect(greeted.body.outcome).toBe('reply');
    expect(greeted.body.messages.at(-1).body).toMatch(/North Clinic/);
    expect(model.calls).toBe(calls);

    const selected = await say(patient, session, 'Follow-up');
    expect(selected.body.workflow.serviceId).toBe(serviceId);
    expect(selected.body.outcome).toBe('reply');
    expect(selected.body.messages.at(-1).body).toMatch(/which day/i);
    expect(selected.body.appointment).toBeNull();
    expect(model.calls).toBe(calls);

    const before = await prisma.appointment.count();
    const slots = await say(patient, session, 'Tomorrow');
    expect(slots.body.outcome).toBe('slots');
    expect(slots.body.workflow.offeredSlots.length).toBeGreaterThan(0);
    expect(slots.body.appointment).toBeNull();
    expect(model.calls).toBe(calls);
    expect(await prisma.appointment.count()).toBe(before);
  });

  it('keeps the workflow when a free-form question cannot be interpreted', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    await say(patient, session, 'Follow-up');
    const before = await prisma.appointment.count();
    model.push(
      new ModelRequestError(
        'RATE_LIMITED',
        'The scheduling assistant is busy. Wait a moment or use the booking form.',
        429,
      ),
    );
    const failed = await say(patient, session, 'What should I bring to the visit?');
    expect(failed.body.outcome).toBe('unavailable');
    expect(failed.body.workflow.serviceId).toBe(serviceId);
    expect(failed.body.manualBooking.serviceId).toBe(serviceId);
    expect(
      failed.body.messages.filter(
        (message: { senderKind: string }) => message.senderKind === 'user',
      ),
    ).toHaveLength(2);
    expect(await prisma.appointment.count()).toBe(before);

    model.push(intent({ intent: 'unsupported' }));
    const retried = await say(patient, session, 'What should I bring to the visit?', true);
    expect(retried.body.outcome).toBe('reply');
    expect(retried.body.messages.at(-1).body).toMatch(/cannot help/i);
    expect(
      retried.body.messages.filter(
        (message: { senderKind: string }) => message.senderKind === 'user',
      ),
    ).toHaveLength(2);
    expect(retried.body.workflow.serviceId).toBe(serviceId);
    expect(retried.body.appointment).toBeNull();
  });

  it('answers a service question from the catalog and declines an unsupported question', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    model.push(intent({ intent: 'clarify', topic: 'services', needsClarification: true }));
    const services = await say(patient, session, 'Which visits can I book?');
    expect(services.body.outcome).toBe('reply');
    expect(services.body.messages.at(-1).body).toContain('Follow-up');
    expect(services.body.messages.at(-1).body).toContain('20 minutes');
    expect(services.body.appointment).toBeNull();

    model.push(intent({ intent: 'list', proposedAction: 'list_visits' }));
    const listed = await say(patient, session, 'Show the visits on my record');
    expect(listed.body.outcome).toBe('listed');
    expect(listed.body.appointment).toBeNull();
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

  it('books a natural request, answers from the catalog, and recovers from a rate limit', async () => {
    const anonymous = await request(app).get('/api/auth/me');
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const patient = await signIn('patient.assistant@north.example');
    const signedIn = await request(app).get('/api/auth/me').set('Cookie', patient.cookie);
    expect(signedIn.status).toBe(200);
    expect(signedIn.body.user.email).toBe('patient.assistant@north.example');

    const session = await openSession(patient);
    const calls = model.calls;
    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'next Thursday',
        timePreference: 'morning',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    const asked = await say(patient, session, 'I need a follow-up next Thursday morning.');
    expect(model.calls).toBe(calls + 1);
    expect(asked.body.outcome).toBe('slots');
    expect(asked.body.appointment).toBeNull();
    expect(asked.body.workflow.serviceId).toBe(serviceId);
    expect(asked.body.workflow.date).toBe('2026-10-15');
    expect(asked.body.workflow.offeredSlots.length).toBeGreaterThan(0);
    for (const slot of asked.body.workflow.offeredSlots) {
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          hour: 'numeric',
          hourCycle: 'h23',
        }).format(new Date(slot.startsAt)),
      );
      expect(hour).toBeLessThan(12);
    }

    const slot = asked.body.workflow.offeredSlots[0];
    const review = await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
    expect(review.body.outcome).toBe('review');
    expect(review.body.appointment).toBeNull();
    expect(review.body.messages.at(-1).body).toMatch(/not saved until you confirm/i);

    const beforeBooked = await prisma.appointment.count();
    const confirmed = await confirm(patient, session);
    expect(confirmed.body.outcome).toBe('booked');
    expect(confirmed.body.appointment.startsAt).toBe(slot.startsAt);
    expect(await prisma.appointment.count()).toBe(beforeBooked + 1);

    await prisma.service.create({
      data: { businessId: clinicId, name: 'Annual physical', durationMinutes: 40 },
    });
    model.push(intent({ intent: 'clarify', topic: 'services', needsClarification: true }));
    const services = await say(patient, session, 'What services does this clinic offer?');
    expect(services.body.outcome).toBe('reply');
    expect(services.body.appointment).toBeNull();
    expect(services.body.messages.at(-1).body).toContain('Follow-up (20 minutes)');
    expect(services.body.messages.at(-1).body).toContain('Annual physical (40 minutes)');
    expect(services.body.workflow.appointmentId).toBe(confirmed.body.appointment.id);

    const beforeLimit = await prisma.appointment.count();
    model.push(
      new ModelRequestError(
        'RATE_LIMITED',
        'The scheduling assistant is busy. Wait a moment or use the booking form.',
        429,
      ),
    );
    const limited = await say(patient, session, 'Can I come earlier that day?');
    expect(limited.body.outcome).toBe('unavailable');
    expect(limited.body.appointment).toBeNull();
    expect(limited.body.messages.at(-1).body).toMatch(/busy|booking form/i);
    expect(limited.body.messages.at(-1).body).not.toMatch(/confirmed for|is now/i);
    expect(limited.body.workflow.appointmentId).toBe(confirmed.body.appointment.id);
    expect(limited.body.manualBooking.serviceId).toBe(serviceId);
    expect(await prisma.appointment.count()).toBe(beforeLimit);
    const userMessages = limited.body.messages.filter(
      (message: { senderKind: string }) => message.senderKind === 'user',
    );
    expect(userMessages.map((message: { body: string }) => message.body)).toEqual([
      'I need a follow-up next Thursday morning.',
      'What services does this clinic offer?',
      'Can I come earlier that day?',
    ]);

    model.push(intent({ intent: 'unsupported' }));
    const retried = await say(patient, session, 'Can I come earlier that day?', true);
    expect(retried.body.outcome).toBe('reply');
    expect(retried.body.appointment).toBeNull();
    expect(
      retried.body.messages.filter(
        (message: { senderKind: string }) => message.senderKind === 'user',
      ),
    ).toHaveLength(3);
    expect(await prisma.appointment.count()).toBe(beforeLimit);
  });

  it('replays a lost response and does not repeat a booking', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const turnKey = 'lost-response-turn-01';
    model.push(intent({ intent: 'unsupported' }));
    const first = await say(patient, session, 'What should I bring?', false, turnKey);
    expect(first.body.outcome).toBe('reply');
    const calls = model.calls;
    const messages = first.body.messages.length;
    const before = await prisma.appointment.count();

    const replayed = await say(patient, session, 'What should I bring?', false, turnKey);
    expect(replayed.body.outcome).toBe('reply');
    expect(replayed.body.messages).toHaveLength(messages);
    expect(model.calls).toBe(calls);
    expect(await prisma.appointment.count()).toBe(before);

    const lostSuccess = await say(patient, session, 'What should I bring?', true, turnKey);
    expect(lostSuccess.body.outcome).toBe('reply');
    expect(lostSuccess.body.messages).toHaveLength(messages);
    expect(model.calls).toBe(calls);
    expect(await prisma.appointment.count()).toBe(before);

    model.push(
      intent({
        intent: 'book',
        serviceQuery: 'Follow-up',
        datePreference: 'next Thursday',
        timePreference: 'morning',
        proposedAction: 'search_availability',
        confirmationState: 'required',
      }),
    );
    const bookingKey = 'lost-response-turn-02';
    const asked = await say(
      patient,
      session,
      'I need a follow-up next Thursday morning.',
      false,
      bookingKey,
    );
    expect(asked.body.outcome).toBe('slots');
    expect(asked.body.appointment).toBeNull();
    const slot = asked.body.workflow.offeredSlots[0];
    await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
    const confirmed = await confirm(patient, session);
    expect(confirmed.body.outcome).toBe('booked');
    const booked = await prisma.appointment.count();
    const afterBook = model.calls;

    const repeated = await say(
      patient,
      session,
      'I need a follow-up next Thursday morning.',
      false,
      bookingKey,
    );
    expect(repeated.body.outcome).toBe('slots');
    expect(repeated.body.appointment).toBeNull();
    expect(model.calls).toBe(afterBook);
    expect(await prisma.appointment.count()).toBe(booked);
    const again = await confirm(patient, session);
    expect(again.body.appointment.id).toBe(confirmed.body.appointment.id);
    expect(await prisma.appointment.count()).toBe(booked);

    const failureKey = 'lost-response-turn-03';
    model.push(
      new ModelRequestError(
        'RATE_LIMITED',
        'The scheduling assistant is busy. Wait a moment or use the booking form.',
        429,
      ),
    );
    const failed = await say(patient, session, 'Can I come earlier that day?', false, failureKey);
    expect(failed.body.outcome).toBe('unavailable');
    const failedCalls = model.calls;
    const failedUsers = failed.body.messages.filter(
      (message: { senderKind: string }) => message.senderKind === 'user',
    ).length;
    const lost = await say(patient, session, 'Can I come earlier that day?', false, failureKey);
    expect(lost.body.outcome).toBe('unavailable');
    expect(model.calls).toBe(failedCalls);
    expect(
      lost.body.messages.filter((message: { senderKind: string }) => message.senderKind === 'user'),
    ).toHaveLength(failedUsers);

    model.push(intent({ intent: 'unsupported' }));
    const retried = await say(patient, session, 'Can I come earlier that day?', true, failureKey);
    expect(retried.body.outcome).toBe('reply');
    expect(
      retried.body.messages.filter(
        (message: { senderKind: string }) => message.senderKind === 'user',
      ),
    ).toHaveLength(failedUsers);
    expect(await prisma.appointment.count()).toBe(booked);
  });

  it('runs one model call when two requests share a turn key', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const calls = model.calls;
    const hold = model.holdNext();
    model.push(intent({ intent: 'unsupported' }));
    let markWaiting: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    turnHooks.onTurnWait = () => markWaiting();
    const turnKey = 'concurrent-turn-key-01';
    try {
      const pending = Promise.all([
        say(patient, session, 'What should I bring?', false, turnKey),
        say(patient, session, 'What should I bring?', false, turnKey),
      ]);
      await hold.entered;
      await waiting;
      hold.release();
      const [left, right] = await pending;
      expect(left.status).toBe(200);
      expect(right.status).toBe(200);
      expect(left.body.outcome).toBe('reply');
      expect(right.body.outcome).toBe('reply');
      expect(left.body.appointment).toBeNull();
      expect(right.body.appointment).toBeNull();
      expect(model.calls).toBe(calls + 1);
      const messages = await sessionMessages(session);
      expect(messages.filter((message) => message.senderKind === 'user')).toHaveLength(1);
      expect(messages.filter((message) => message.senderKind === 'assistant')).toHaveLength(1);
      expect(await prisma.appointment.count()).toBe(before);
    } finally {
      hold.release();
    }
  });

  it('does not start a second model call when retry arrives during processing', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const calls = model.calls;
    const hold = model.holdNext();
    model.push(intent({ intent: 'unsupported' }));
    let markWaiting: () => void = () => {};
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve;
    });
    turnHooks.onTurnWait = () => markWaiting();
    const turnKey = 'concurrent-retry-key-01';
    try {
      const first = say(patient, session, 'What should I bring?', false, turnKey);
      const started = Promise.resolve(first);
      await hold.entered;
      const second = Promise.resolve(say(patient, session, 'What should I bring?', true, turnKey));
      await waiting;
      hold.release();
      const [left, right] = await Promise.all([started, second]);
      expect(left.body.outcome).toBe('reply');
      expect(right.body.outcome).toBe('reply');
      expect(left.body.appointment).toBeNull();
      expect(right.body.appointment).toBeNull();
      expect(model.calls).toBe(calls + 1);
      const messages = await sessionMessages(session);
      expect(messages.filter((message) => message.senderKind === 'user')).toHaveLength(1);
      expect(messages.filter((message) => message.senderKind === 'assistant')).toHaveLength(1);
      expect(await prisma.appointment.count()).toBe(before);
    } finally {
      hold.release();
    }
  });

  it('recovers an abandoned claim without another user message or a visit change', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const calls = model.calls;
    const turnKey = 'abandoned-claim-turn-01';
    model.push(intent({ intent: 'unsupported' }));
    turnHooks.beforeTurnPersist = async () => {
      throw new Error('persistence stopped');
    };
    const interrupted = await say(patient, session, 'What should I bring?', false, turnKey);
    expect(interrupted.status).toBe(200);
    expect(interrupted.body.outcome).toBe('unavailable');
    expect(interrupted.body.appointment).toBeNull();
    expect(interrupted.body.messages.at(-1).body).toMatch(/nothing has been booked/i);
    const during = await sessionMessages(session);
    expect(during.filter((message) => message.senderKind === 'user')).toHaveLength(1);
    expect(during.filter((message) => message.senderKind === 'assistant')).toHaveLength(0);
    const stored = await prisma.chatSession.findUniqueOrThrow({
      where: { id: session },
      select: { workflowState: true },
    });
    const workflow = stored.workflowState as { turnSettled?: boolean; turnClaim?: string | null };
    expect(workflow.turnSettled).toBe(false);
    expect(workflow.turnClaim).toEqual(expect.any(String));
    expect(model.calls).toBe(calls + 1);
    expect(await prisma.appointment.count()).toBe(before);

    assistantNow = new Date(fixedNow.getTime() + TURN_CLAIM_TTL_MS + 1);
    turnHooks.beforeTurnPersist = null;
    model.push(intent({ intent: 'unsupported' }));
    const recovered = await say(patient, session, 'What should I bring?', false, turnKey);
    expect(recovered.body.outcome).toBe('reply');
    expect(recovered.body.appointment).toBeNull();
    expect(model.calls).toBe(calls + 2);
    const after = await sessionMessages(session);
    expect(after.filter((message) => message.senderKind === 'user')).toHaveLength(1);
    expect(after.filter((message) => message.senderKind === 'assistant')).toHaveLength(1);
    expect(await prisma.appointment.count()).toBe(before);
  });

  it('drops a late completion that lost its claim', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const calls = model.calls;
    const turnKey = 'late-completion-turn-01';
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    turnHooks.beforeTurnPersist = () => {
      turnHooks.beforeTurnPersist = null;
      entered();
      return gate;
    };
    model.push(intent({ intent: 'unsupported' }));
    model.push(intent({ intent: 'unsupported' }));
    const first = Promise.resolve(say(patient, session, 'What should I bring?', false, turnKey));
    try {
      await enteredPromise;
      assistantNow = new Date(fixedNow.getTime() + TURN_CLAIM_TTL_MS + 1);
      const second = await say(patient, session, 'What should I bring?', false, turnKey);
      release();
      const late = await first;
      expect(second.body.outcome).toBe('reply');
      expect(late.body.outcome).toBe('reply');
      expect(second.body.appointment).toBeNull();
      expect(late.body.appointment).toBeNull();
      expect(model.calls).toBe(calls + 2);
      const messages = await sessionMessages(session);
      expect(messages.filter((message) => message.senderKind === 'user')).toHaveLength(1);
      expect(messages.filter((message) => message.senderKind === 'assistant')).toHaveLength(1);
      expect(await prisma.appointment.count()).toBe(before);
    } finally {
      release();
    }
  });

  it('does not let slot selection erase a completed reply', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const asked = await askForSlots(patient, session);
    const slot = asked.body.workflow.offeredSlots[0];
    let release: () => void = () => {};
    let entered: () => void = () => {};
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    turnHooks.beforeWorkflowSave = () => {
      turnHooks.beforeWorkflowSave = null;
      entered();
      return new Promise<void>((resolve) => {
        release = resolve;
      });
    };
    model.push(intent({ intent: 'unsupported' }));
    const selecting = Promise.resolve(
      request(app)
        .post(`/api/assistant/sessions/${session}/slots`)
        .set(CARE_FLOW_REQUEST_HEADER, '1')
        .set(CSRF_HEADER, patient.csrf)
        .set('Cookie', patient.cookie)
        .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt }),
    );
    try {
      await enteredPromise;
      const answered = await say(
        patient,
        session,
        'What should I bring?',
        false,
        'slot-race-turn-01',
      );
      expect(answered.body.outcome).toBe('reply');
      release();
      const selected = await selecting;
      expect(selected.body.appointment).toBeNull();
      const stored = await workflowOf(session);
      expect(stored.turnSettled).toBe(true);
      expect(stored.turnClaim).toBeNull();
      const messages = await sessionMessages(session);
      expect(messages.some((message) => /cannot help with that request/i.test(message.body))).toBe(
        true,
      );
      expect(await prisma.appointment.count()).toBe(before);
    } finally {
      release();
    }
  });

  it('does not let confirmation erase an active claim or book twice', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const asked = await askForSlots(patient, session);
    const slot = asked.body.workflow.offeredSlots[0];
    const review = await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
    expect(review.status).toBe(200);
    let releaseSave: () => void = () => {};
    let saveEntered: () => void = () => {};
    const saveEnteredPromise = new Promise<void>((resolve) => {
      saveEntered = resolve;
    });
    turnHooks.beforeWorkflowSave = () => {
      turnHooks.beforeWorkflowSave = null;
      saveEntered();
      return new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    };
    let releasePersist: () => void = () => {};
    let persistEntered: () => void = () => {};
    const persistEnteredPromise = new Promise<void>((resolve) => {
      persistEntered = resolve;
    });
    turnHooks.beforeTurnPersist = () => {
      turnHooks.beforeTurnPersist = null;
      persistEntered();
      return new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
    };
    model.push(intent({ intent: 'unsupported' }));
    const confirming = Promise.resolve(confirm(patient, session));
    try {
      await saveEnteredPromise;
      const messaging = Promise.resolve(
        say(patient, session, 'What should I bring?', false, 'confirm-race-turn-01'),
      );
      await persistEnteredPromise;
      const during = await workflowOf(session);
      expect(during.turnClaim).toEqual(expect.any(String));
      releaseSave();
      const paused = await confirming;
      expect(paused.body.appointment).toBeNull();
      expect((await workflowOf(session)).turnClaim).toEqual(expect.any(String));
      expect(await prisma.appointment.count()).toBe(before);
      releasePersist();
      const answered = await messaging;
      expect(answered.body.outcome).toBe('reply');
      expect(await prisma.appointment.count()).toBe(before);

      const [firstBooking, secondBooking] = await Promise.all([
        confirm(patient, session),
        confirm(patient, session),
      ]);
      expect(firstBooking.body.outcome).toBe('booked');
      expect(secondBooking.body.appointment.id).toBe(firstBooking.body.appointment.id);
      expect(await prisma.appointment.count()).toBe(before + 1);
    } finally {
      releaseSave();
      releasePersist();
    }
  });

  it('records a visit when confirmation races an assistant claim', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const before = await prisma.appointment.count();
    const asked = await askForSlots(patient, session);
    const slot = asked.body.workflow.offeredSlots[0];
    const review = await request(app)
      .post(`/api/assistant/sessions/${session}/slots`)
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, patient.csrf)
      .set('Cookie', patient.cookie)
      .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
    expect(review.status).toBe(200);
    let saves = 0;
    let releaseSave: () => void = () => {};
    let saveEntered: () => void = () => {};
    const saveEnteredPromise = new Promise<void>((resolve) => {
      saveEntered = resolve;
    });
    turnHooks.beforeWorkflowSave = () => {
      saves += 1;
      if (saves === 1) {
        return Promise.resolve();
      }
      turnHooks.beforeWorkflowSave = null;
      saveEntered();
      return new Promise<void>((resolve) => {
        releaseSave = resolve;
      });
    };
    let releasePersist: () => void = () => {};
    let persistEntered: () => void = () => {};
    const persistEnteredPromise = new Promise<void>((resolve) => {
      persistEntered = resolve;
    });
    turnHooks.beforeTurnPersist = () => {
      turnHooks.beforeTurnPersist = null;
      persistEntered();
      return new Promise<void>((resolve) => {
        releasePersist = resolve;
      });
    };
    model.push(intent({ intent: 'unsupported' }));
    const confirming = Promise.resolve(confirm(patient, session));
    try {
      await saveEnteredPromise;
      const messaging = Promise.resolve(
        say(patient, session, 'What should I bring?', false, 'confirm-effect-turn-01'),
      );
      await persistEnteredPromise;
      releaseSave();
      const booked = await confirming;
      expect(booked.status).toBe(200);
      expect(booked.body.outcome).toBe('booked');
      expect(booked.body.appointment).not.toBeNull();
      const during = await workflowOf(session);
      expect(during.phase).toBe('completed');
      expect(during.appointmentId).toBe(booked.body.appointment.id);
      expect(during.turnClaim).toEqual(expect.any(String));
      expect(await prisma.appointment.count()).toBe(before + 1);
      releasePersist();
      const answered = await messaging;
      expect(answered.body.outcome).toBe('reply');
      expect(answered.body.workflow.phase).toBe('completed');
      expect(answered.body.appointment.id).toBe(booked.body.appointment.id);
      const after = await workflowOf(session);
      expect(after.phase).toBe('completed');
      expect(after.appointmentId).toBe(booked.body.appointment.id);
      expect(after.turnClaim).toBeNull();
      expect(after.turnSettled).toBe(true);
      const messages = await sessionMessages(session);
      expect(messages.some((message) => /is confirmed for/i.test(message.body))).toBe(true);
      expect(messages.some((message) => /cannot help with that request/i.test(message.body))).toBe(
        true,
      );
      const again = await confirm(patient, session);
      expect(again.body.appointment.id).toBe(booked.body.appointment.id);
      expect(await prisma.appointment.count()).toBe(before + 1);
    } finally {
      releaseSave();
      releasePersist();
    }
  });

  it('recovers cancellation confirmation after a crash before the workflow save', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const visit = await bookVisit(patient, session);
    await prepareCancel(patient, session, visit.id);
    crashAfterScheduling();
    const failed = await confirm(patient, session);
    expect(failed.status).toBe(500);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: visit.id } })).toMatchObject({
      status: 'cancelled',
    });
    expect((await workflowOf(session)).phase).toBe('awaiting_cancel_confirmation');
    expect(
      await prisma.auditEvent.count({
        where: { action: 'appointment_cancelled', entityId: visit.id },
      }),
    ).toBe(1);

    turnHooks.beforeWorkflowSave = null;
    const recovered = await confirm(patient, session);
    expect(recovered.status).toBe(200);
    expect(recovered.body.outcome).toBe('cancelled');
    expect(recovered.body.appointment.id).toBe(visit.id);
    expect(recovered.body.workflow.phase).toBe('completed');
    expect(
      await prisma.auditEvent.count({
        where: { action: 'appointment_cancelled', entityId: visit.id },
      }),
    ).toBe(1);
  });

  it('recovers reschedule confirmation after a crash before the workflow save', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const visit = await bookVisit(patient, session);
    const slot = await prepareReschedule(patient, session, visit.id);
    const before = await prisma.appointment.count();
    crashAfterScheduling();
    const failed = await confirm(patient, session);
    expect(failed.status).toBe(500);
    expect(await prisma.appointment.findUniqueOrThrow({ where: { id: visit.id } })).toMatchObject({
      status: 'cancelled',
    });
    const moved = await prisma.appointment.findFirstOrThrow({
      where: { rescheduledFromAppointmentId: visit.id },
      select: { id: true, startsAt: true, status: true },
    });
    expect(moved.status).toBe('confirmed');
    expect(moved.startsAt.toISOString()).toBe(slot.startsAt);
    expect((await workflowOf(session)).phase).toBe('awaiting_reschedule_confirmation');
    expect((await workflowOf(session)).appointmentId).toBe(visit.id);
    expect(await prisma.appointment.count()).toBe(before + 1);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'appointment_rescheduled', entityId: moved.id },
      }),
    ).toBe(1);

    turnHooks.beforeWorkflowSave = null;
    const recovered = await confirm(patient, session);
    expect(recovered.status).toBe(200);
    expect(recovered.body.outcome).toBe('rescheduled');
    expect(recovered.body.appointment.id).toBe(moved.id);
    expect(recovered.body.workflow.phase).toBe('completed');
    expect(recovered.body.workflow.appointmentId).toBe(moved.id);
    expect(await prisma.appointment.count()).toBe(before + 1);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'appointment_rescheduled', entityId: moved.id },
      }),
    ).toBe(1);
  });

  it('keeps a single cancellation audit for concurrent confirms', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const visit = await bookVisit(patient, session);
    await prepareCancel(patient, session, visit.id);
    const [first, second] = await Promise.all([
      confirm(patient, session),
      confirm(patient, session),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.appointment.id).toBe(visit.id);
    expect(second.body.appointment.id).toBe(visit.id);
    expect(first.body.outcome).toBe('cancelled');
    expect(second.body.outcome).toBe('cancelled');
    expect((await workflowOf(session)).phase).toBe('completed');
    expect(
      await prisma.auditEvent.count({
        where: { action: 'appointment_cancelled', entityId: visit.id },
      }),
    ).toBe(1);
  });

  it('keeps a single rescheduled visit for concurrent confirms', async () => {
    const patient = await signIn('patient.assistant@north.example');
    const session = await openSession(patient);
    const visit = await bookVisit(patient, session);
    const slot = await prepareReschedule(patient, session, visit.id);
    const before = await prisma.appointment.count();
    const [first, second] = await Promise.all([
      confirm(patient, session),
      confirm(patient, session),
    ]);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.appointment.id).toBe(second.body.appointment.id);
    expect(first.body.appointment.startsAt).toBe(slot.startsAt);
    expect(first.body.outcome).toBe('rescheduled');
    expect(second.body.outcome).toBe('rescheduled');
    expect((await workflowOf(session)).appointmentId).toBe(first.body.appointment.id);
    expect(await prisma.appointment.count()).toBe(before + 1);
    expect(
      await prisma.auditEvent.count({
        where: { action: 'appointment_rescheduled', entityId: first.body.appointment.id },
      }),
    ).toBe(1);
  });
});

async function bookVisit(patient: Session, session: string) {
  const owner = await prisma.user.findFirstOrThrow({
    where: { email: 'patient.assistant@north.example' },
    select: { id: true },
  });
  await prisma.appointment.updateMany({
    where: {
      patientUserId: owner.id,
      businessId: clinicId,
      status: { in: ['requested', 'confirmed'] },
    },
    data: { status: 'cancelled', cancelledAt: fixedNow },
  });
  const asked = await askForSlots(patient, session);
  const slot = asked.body.workflow.offeredSlots[0];
  const review = await request(app)
    .post(`/api/assistant/sessions/${session}/slots`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
  expect(review.status).toBe(200);
  const booked = await confirm(patient, session);
  expect(booked.status).toBe(200);
  expect(booked.body.outcome).toBe('booked');
  return booked.body.appointment as { id: string; startsAt: string };
}

async function prepareCancel(patient: Session, session: string, appointmentId: string) {
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
  expect(prepared.status).toBe(200);
  expect(prepared.body.workflow.phase).toBe('awaiting_cancel_confirmation');
  expect(prepared.body.workflow.appointmentId).toBe(appointmentId);
}

async function prepareReschedule(patient: Session, session: string, appointmentId: string) {
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
  expect(move.status).toBe(200);
  expect(move.body.outcome).toBe('slots');
  expect(move.body.workflow.appointmentId).toBe(appointmentId);
  const slot = move.body.workflow.offeredSlots.at(-1);
  expect(slot).toBeTruthy();
  const review = await request(app)
    .post(`/api/assistant/sessions/${session}/slots`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({ staffUserId: slot.staffUserId, startsAt: slot.startsAt });
  expect(review.status).toBe(200);
  expect(review.body.workflow.phase).toBe('awaiting_reschedule_confirmation');
  return slot as { staffUserId: string; startsAt: string };
}

function crashAfterScheduling() {
  let saves = 0;
  turnHooks.beforeWorkflowSave = async () => {
    saves += 1;
    if (saves === 1) {
      return;
    }
    turnHooks.beforeWorkflowSave = null;
    throw new Error('stopped before workflow save');
  };
}

async function askForSlots(patient: Session, session: string) {
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
  const asked = await say(patient, session, 'I need a follow-up tomorrow morning');
  expect(asked.status).toBe(200);
  expect(asked.body.outcome).toBe('slots');
  return asked;
}

async function workflowOf(sessionId: string) {
  const row = await prisma.chatSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: { workflowState: true },
  });
  return row.workflowState as {
    phase?: string;
    appointmentId?: string | null;
    turnClaim?: string | null;
    turnSettled?: boolean;
    revision?: number;
  };
}

async function sessionMessages(sessionId: string) {
  return prisma.chatMessage.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'asc' },
    select: { senderKind: true, body: true },
  });
}

type Session = { cookie: string; csrf: string };
type ScriptedModel = {
  client: ModelClient;
  push: (value: string | ModelRequestError) => void;
  holdNext: () => { entered: Promise<void>; release: () => void };
  calls: number;
  lastHistory: number;
};

function scriptedModel(): ScriptedModel {
  const queue: Array<string | ModelRequestError> = [];
  const state = { calls: 0, lastHistory: 0 };
  let hold: { entered: () => void; gate: Promise<void> } | null = null;
  return {
    client: {
      async complete(input) {
        state.calls += 1;
        state.lastHistory = input.messages.length;
        const pending = hold;
        hold = null;
        if (pending) {
          pending.entered();
          await pending.gate;
        }
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
    holdNext() {
      let entered!: () => void;
      let release!: () => void;
      const enteredPromise = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      hold = { entered, gate };
      return { entered: enteredPromise, release };
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

function say(patient: Session, sessionId: string, text: string, retry = false, turnKey?: string) {
  return request(app)
    .post(`/api/assistant/sessions/${sessionId}/messages`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({
      text,
      ...(retry ? { retry: true } : {}),
      ...(turnKey ? { turnKey } : {}),
    });
}

function confirm(patient: Session, sessionId: string) {
  return request(app)
    .post(`/api/assistant/sessions/${sessionId}/confirm`)
    .set(CARE_FLOW_REQUEST_HEADER, '1')
    .set(CSRF_HEADER, patient.csrf)
    .set('Cookie', patient.cookie)
    .send({ confirmed: true });
}
