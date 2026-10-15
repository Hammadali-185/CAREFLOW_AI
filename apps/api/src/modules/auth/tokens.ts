import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_COOKIE_NAME = 'careflow_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export function createSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfTokenFor(sessionToken: string, csrfSecret: string): string {
  return createHmac('sha256', csrfSecret).update(sessionToken).digest('base64url');
}

export function csrfTokensMatch(provided: string | undefined, expected: string): boolean {
  if (!provided) {
    return false;
  }

  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) {
    return false;
  }

  return timingSafeEqual(actual, wanted);
}
