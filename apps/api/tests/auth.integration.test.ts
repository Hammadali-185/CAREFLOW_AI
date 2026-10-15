import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CARE_FLOW_REQUEST_HEADER, CSRF_HEADER, authSessionResponseSchema } from '@careflow/shared';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/modules/auth/password.js';
import { createApp } from '../src/app.js';
import { createPrismaAuthRepository } from '../src/repositories/auth.repository.js';
import { createPrismaClient } from '../src/repositories/prisma.js';
import type { PrismaClient } from '../src/generated/prisma/client.js';
import { createAuthService } from '../src/services/auth.service.js';
import { silentLogger } from '../src/utils/logger.js';
import { unusedAssistant } from './unused-assistant.js';
import { unusedScheduling } from './unused-scheduling.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const csrfSecret = 'test-csrf-secret-that-is-long-enough';
const origin = 'http://127.0.0.1:5173';
const password = 'CorrectHorse!2026';

let database: PGlite;
let socket: PGLiteSocketServer;
let prisma: PrismaClient;
let app: Express;
let clinicId = '';

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
  socket = new PGLiteSocketServer({ db: database, port: 55441, host: '127.0.0.1' });
  await socket.start();
  prisma = createPrismaClient(
    'postgresql://postgres:postgres@127.0.0.1:55441/postgres?sslmode=disable',
  );
  const clinic = await prisma.business.create({
    data: { name: 'North Clinic', slug: 'north-clinic', timezone: 'America/New_York' },
    select: { id: true },
  });
  clinicId = clinic.id;
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      email: 'owner@north.example',
      passwordHash,
      displayName: 'Olivia Owner',
      memberships: { create: { businessId: clinicId, role: 'owner' } },
    },
  });
  await prisma.user.create({
    data: {
      email: 'staff@north.example',
      passwordHash,
      displayName: 'Sam Staff',
      memberships: { create: { businessId: clinicId, role: 'staff' } },
    },
  });
  app = createApp({
    corsOrigins: [origin],
    probe: { async ping() {} },
    logger: silentLogger,
    nodeEnv: 'test',
    authRateLimit: { limit: 50, windowMs: 60_000 },
    auth: createAuthService({
      repository: createPrismaAuthRepository(prisma),
      csrfSecret,
    }),
    scheduling: unusedScheduling,
    assistant: unusedAssistant,
  });
}, 30_000);

afterAll(async () => {
  await prisma?.$disconnect();
  await socket?.stop();
  await database?.close();
});

function post(path: string) {
  return request(app).post(path).set(CARE_FLOW_REQUEST_HEADER, '1');
}

describe('authentication', () => {
  it('registers a patient, rejects a duplicate, and signs in with a new session', async () => {
    const created = await post('/api/auth/signup').set('Origin', origin).send({
      email: 'Pat.IENT@north.example',
      password,
      displayName: 'Pat Patient',
      businessSlug: 'north-clinic',
    });

    expect(created.status).toBe(201);
    const session = authSessionResponseSchema.parse(created.body);
    expect(session.user.email).toBe('pat.ient@north.example');
    expect(session.user.memberships).toEqual([
      expect.objectContaining({ role: 'patient', businessSlug: 'north-clinic' }),
    ]);
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash|password_hash|tokenHash/);
    expect(cookieHeader(created.headers['set-cookie'])).toMatch(/careflow_session=/);
    expect(cookieHeader(created.headers['set-cookie'])).toMatch(/HttpOnly/i);
    expect(cookieHeader(created.headers['set-cookie'])).toMatch(/SameSite=Lax/i);
    expect(created.headers['access-control-allow-origin']).toBe(origin);
    expect(created.headers['access-control-allow-credentials']).toBe('true');

    const duplicate = await post('/api/auth/signup').send({
      email: 'pat.ient@north.example',
      password,
      displayName: 'Pat Patient',
      businessSlug: 'north-clinic',
    });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ACCOUNT_EXISTS');

    const agent = request.agent(app);
    const first = await agent
      .post('/api/auth/login')
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .send({ email: 'pat.ient@north.example', password });
    expect(first.status).toBe(200);
    const firstCookie = cookieValue(first.headers['set-cookie']);

    const second = await agent
      .post('/api/auth/login')
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .send({ email: 'pat.ient@north.example', password });
    expect(second.status).toBe(200);
    const secondCookie = cookieValue(second.headers['set-cookie']);
    expect(secondCookie).not.toBe(firstCookie);

    const stale = await request(app)
      .get('/api/auth/me')
      .set('Cookie', `careflow_session=${firstCookie}`);
    expect(stale.status).toBe(401);

    const current = await agent.get('/api/auth/me');
    expect(current.status).toBe(200);
    expect(current.body.user.displayName).toBe('Pat Patient');
    expect(current.body.csrfToken).toBe(second.body.csrfToken);
  });

  it('uses the same message for an unknown email and a wrong password', async () => {
    const unknown = await post('/api/auth/login').send({
      email: 'missing@north.example',
      password,
    });
    const wrong = await post('/api/auth/login').send({
      email: 'pat.ient@north.example',
      password: 'not-the-password',
    });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.error.code).toBe('AUTHENTICATION_FAILED');
  });

  it('rejects login and registration that omit the browser request header', async () => {
    const response = await request(app).post('/api/auth/login').send({
      email: 'pat.ient@north.example',
      password,
    });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_REJECTED');
  });

  it('rejects invalid signup bodies', async () => {
    const response = await post('/api/auth/signup').send({
      email: 'not-an-email',
      password: 'short',
      displayName: '',
      businessSlug: 'North Clinic',
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('logs out, rejects a missing CSRF token, and refuses the revoked session', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .send({ email: 'owner@north.example', password });
    expect(login.status).toBe(200);

    const missing = await agent.post('/api/auth/logout').set(CARE_FLOW_REQUEST_HEADER, '1');
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_REJECTED');

    const logout = await agent
      .post('/api/auth/logout')
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .set(CSRF_HEADER, login.body.csrfToken);
    expect(logout.status).toBe(204);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects an expired session', async () => {
    const login = await post('/api/auth/login').send({ email: 'staff@north.example', password });
    expect(login.status).toBe(200);
    await prisma.authSession.updateMany({
      where: { user: { email: 'staff@north.example' }, revokedAt: null },
      data: {
        createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const me = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieHeader(login.headers['set-cookie']));
    expect(me.status).toBe(401);
    expect(me.body.error.message).toBe('Sign in to continue.');
  });

  it('distinguishes a missing session from a role the user does not have', async () => {
    const patient = await post('/api/auth/login').send({
      email: 'pat.ient@north.example',
      password,
    });
    const staff = await post('/api/auth/login').send({ email: 'staff@north.example', password });
    const owner = await post('/api/auth/login').send({ email: 'owner@north.example', password });

    const anonymous = await request(app).get(`/api/clinics/${clinicId}/staff`);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error.code).toBe('UNAUTHENTICATED');

    const patientStaff = await request(app)
      .get(`/api/clinics/${clinicId}/staff`)
      .set('Cookie', cookieHeader(patient.headers['set-cookie']));
    expect(patientStaff.status).toBe(403);
    expect(patientStaff.body.error.code).toBe('FORBIDDEN');

    const staffOk = await request(app)
      .get(`/api/clinics/${clinicId}/staff`)
      .set('Cookie', cookieHeader(staff.headers['set-cookie']));
    expect(staffOk.status).toBe(200);
    expect(staffOk.body.access).toBe('staff');

    const staffAdmin = await request(app)
      .get(`/api/clinics/${clinicId}/admin`)
      .set('Cookie', cookieHeader(staff.headers['set-cookie']));
    expect(staffAdmin.status).toBe(403);

    const ownerAdmin = await request(app)
      .get(`/api/clinics/${clinicId}/admin`)
      .set('Cookie', cookieHeader(owner.headers['set-cookie']));
    expect(ownerAdmin.status).toBe(200);
    expect(ownerAdmin.body).toMatchObject({ role: 'owner', access: 'administrator' });
  });

  it('sets the Secure cookie attribute in production', async () => {
    const production = createApp({
      corsOrigins: [origin],
      probe: { async ping() {} },
      logger: silentLogger,
      nodeEnv: 'production',
      auth: createAuthService({
        repository: createPrismaAuthRepository(prisma),
        csrfSecret,
      }),
      scheduling: unusedScheduling,
      assistant: unusedAssistant,
    });
    const response = await request(production)
      .post('/api/auth/login')
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .send({ email: 'owner@north.example', password });
    expect(response.status).toBe(200);
    expect(cookieHeader(response.headers['set-cookie'])).toMatch(/Secure/i);
  });
});

describe('authentication rate limit', () => {
  it('blocks repeated login attempts', async () => {
    const limited = createApp({
      corsOrigins: [origin],
      probe: { async ping() {} },
      logger: silentLogger,
      nodeEnv: 'test',
      authRateLimit: { limit: 2, windowMs: 60_000 },
      auth: createAuthService({
        repository: createPrismaAuthRepository(prisma),
        csrfSecret,
      }),
      scheduling: unusedScheduling,
      assistant: unusedAssistant,
    });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await request(limited)
        .post('/api/auth/login')
        .set(CARE_FLOW_REQUEST_HEADER, '1')
        .send({ email: 'owner@north.example', password: 'wrong-password' });
      expect(response.status).toBe(401);
    }

    const blocked = await request(limited)
      .post('/api/auth/login')
      .set(CARE_FLOW_REQUEST_HEADER, '1')
      .send({ email: 'owner@north.example', password });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });
});

function cookieHeader(header: string | string[] | undefined): string {
  const values = Array.isArray(header) ? header : header ? [header] : [];
  if (values.length === 0) {
    throw new Error('Session cookie was not set.');
  }
  return values.join('; ');
}

function cookieValue(header: string | string[] | undefined): string {
  const cookie = cookieHeader(header)
    .split(';')
    .map((value) => value.trim())
    .find((value) => value.startsWith('careflow_session='));
  if (!cookie) {
    throw new Error('Session cookie was not set.');
  }
  const pair = cookie.split(';')[0] ?? '';
  return pair.slice('careflow_session='.length);
}
