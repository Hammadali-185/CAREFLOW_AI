import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadWebConfig } from './config';

describe('loadWebConfig', () => {
  it('accepts an absolute API URL and strips a trailing slash', () => {
    expect(loadWebConfig({ VITE_API_BASE_URL: 'http://127.0.0.1:4000/' }).apiBaseUrl).toBe(
      'http://127.0.0.1:4000',
    );
  });

  it('fails when the API URL is missing', () => {
    expect(() => loadWebConfig({})).toThrow(/VITE_API_BASE_URL/);
  });
});

describe('frontend environment example', () => {
  it('exposes only the public API origin', () => {
    const example = readFileSync(path.resolve(process.cwd(), '.env.example'), 'utf8');
    expect(example).toContain('VITE_API_BASE_URL=http://127.0.0.1:4000');
    expect(example).not.toMatch(
      /^\s*(DATABASE_URL|API_KEY|SECRET|PASSWORD|OPENAI_API_KEY|ANTHROPIC_API_KEY)\s*=/im,
    );
    expect(example).not.toMatch(/postgres(?:ql)?:\/\//i);
  });
});
