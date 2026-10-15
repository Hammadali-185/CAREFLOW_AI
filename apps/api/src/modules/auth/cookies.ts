import type { Response } from 'express';
import type { NodeEnv } from '../../config/env.js';
import { SESSION_COOKIE_NAME, SESSION_TTL_MS } from './tokens.js';

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) {
    return undefined;
  }

  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }

    const cookieName = part.slice(0, separator).trim();
    if (cookieName !== name) {
      continue;
    }

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function sessionCookieOptions(nodeEnv: NodeEnv) {
  return {
    httpOnly: true,
    secure: nodeEnv === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: SESSION_TTL_MS,
  };
}

export function setSessionCookie(res: Response, token: string, nodeEnv: NodeEnv) {
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(nodeEnv));
}

export function clearSessionCookie(res: Response, nodeEnv: NodeEnv) {
  res.clearCookie(SESSION_COOKIE_NAME, sessionCookieOptions(nodeEnv));
}
