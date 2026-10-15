import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';

const validEnv = {
  NODE_ENV: 'test',
  PORT: '4000',
  DATABASE_URL: 'postgresql://careflow:careflow@127.0.0.1:5432/careflow',
  CORS_ORIGIN: 'http://127.0.0.1:5173',
  CSRF_SECRET: 'test-csrf-secret-that-is-long-enough',
  LOG_LEVEL: 'info',
};

describe('loadEnv', () => {
  it('accepts the local development configuration', () => {
    const env = loadEnv(validEnv);
    expect(env.port).toBe(4000);
    expect(env.corsOrigins).toEqual(['http://127.0.0.1:5173']);
    expect(env.nodeEnv).toBe('test');
  });

  it('fails when the database URL is missing', () => {
    expect(() => loadEnv({ ...validEnv, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
  });

  it('does not echo a rejected database URL', () => {
    expect(() =>
      loadEnv({ ...validEnv, DATABASE_URL: 'mysql://user:super-secret@localhost/db' }),
    ).toThrow(/PostgreSQL connection string/);
    try {
      loadEnv({ ...validEnv, DATABASE_URL: 'mysql://user:super-secret@localhost/db' });
    } catch (error) {
      expect(error instanceof Error ? error.message : '').not.toContain('super-secret');
    }
  });

  it('rejects a wildcard CORS origin', () => {
    expect(() => loadEnv({ ...validEnv, CORS_ORIGIN: '*' })).toThrow(/wildcard/i);
  });

  it('rejects an origin that is not an absolute URL', () => {
    expect(() => loadEnv({ ...validEnv, CORS_ORIGIN: 'localhost:5173' })).toThrow(/http or https/);
  });
});

describe('API environment example', () => {
  it('documents a local database URL and refuses a wildcard origin', () => {
    const example = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(example).toContain('DATABASE_URL=postgresql://');
    expect(example).toContain('127.0.0.1:5432');
    expect(example).toContain('CSRF_SECRET=');
    expect(example).not.toMatch(/CORS_ORIGIN=\*/);
  });
});
