import {
  errorResponseSchema,
  healthResponseSchema,
  readinessResponseSchema,
} from '@careflow/shared';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import type { DatabaseProbe } from '../src/repositories/database-probe.js';
import type { AuthService } from '../src/services/auth.service.js';
import { silentLogger } from '../src/utils/logger.js';
import { unusedAssistant } from './unused-assistant.js';
import { unusedScheduling } from './unused-scheduling.js';

const allowedOrigin = 'http://127.0.0.1:5173';

const unusedAuth: AuthService = {
  async signup() {
    throw new Error('Auth is not used by the health tests.');
  },
  async login() {
    throw new Error('Auth is not used by the health tests.');
  },
  async logout() {
    throw new Error('Auth is not used by the health tests.');
  },
  async authenticate() {
    return null;
  },
  csrfTokenForSession() {
    return 'unused';
  },
  async clinicAccess() {
    return null;
  },
};

function createTestApp(probe: DatabaseProbe) {
  return createApp({
    corsOrigins: [allowedOrigin],
    probe,
    logger: silentLogger,
    nodeEnv: 'test',
    auth: unusedAuth,
    scheduling: unusedScheduling,
    assistant: unusedAssistant,
  });
}

describe('GET /api/health', () => {
  const app = createTestApp({
    async ping() {},
  });

  it('reports that the process is up without consulting the database', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      service: 'careflow-api',
    });
  });

  it('allows only the configured frontend origin', async () => {
    const allowed = await request(app).get('/api/health').set('Origin', allowedOrigin);
    expect(allowed.headers['access-control-allow-origin']).toBe(allowedOrigin);

    const blocked = await request(app).get('/api/health').set('Origin', 'http://evil.example');
    expect(blocked.headers['access-control-allow-origin']).toBeUndefined();
    expect(blocked.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('rejects unexpected query parameters', async () => {
    const response = await request(app).get('/api/health?debug=true');

    expect(response.status).toBe(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('VALIDATION_ERROR');
  });

  it('sets a content type protection header', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});

describe('GET /api/health/ready', () => {
  it('reports the database as up when the probe succeeds', async () => {
    const app = createTestApp({
      async ping() {},
    });

    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(200);
    expect(readinessResponseSchema.parse(response.body)).toMatchObject({
      status: 'ok',
      database: 'up',
    });
  });

  it('reports the database as down when the probe fails', async () => {
    const app = createTestApp({
      async ping() {
        throw new Error('postgresql://careflow:secret@127.0.0.1:5432/careflow unreachable');
      },
    });

    const response = await request(app).get('/api/health/ready');

    expect(response.status).toBe(503);
    expect(readinessResponseSchema.parse(response.body)).toMatchObject({
      status: 'unavailable',
      database: 'down',
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('also answers GET /api/ready', async () => {
    const app = createTestApp({
      async ping() {},
    });

    const response = await request(app).get('/api/ready');

    expect(response.status).toBe(200);
    expect(readinessResponseSchema.parse(response.body).database).toBe('up');
  });
});

describe('error handling', () => {
  const app = createTestApp({
    async ping() {},
  });

  it('returns a JSON not-found response for unknown routes', async () => {
    const response = await request(app).get('/api/missing');

    expect(response.status).toBe(404);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('NOT_FOUND');
  });

  it('rejects malformed JSON', async () => {
    const response = await request(app)
      .post('/api/health')
      .set('Content-Type', 'application/json')
      .send('{"broken"');

    expect(response.status).toBe(400);
    expect(errorResponseSchema.parse(response.body).error.code).toBe('INVALID_JSON');
  });
});
