import type { MembershipRole } from '@careflow/shared';
import { CARE_FLOW_REQUEST_HEADER, CSRF_HEADER } from '@careflow/shared';
import type { NextFunction, Request, Response } from 'express';
import { clearSessionCookie, readCookie } from '../modules/auth/cookies.js';
import { csrfTokensMatch, SESSION_COOKIE_NAME } from '../modules/auth/tokens.js';
import type { NodeEnv } from '../config/env.js';
import {
  CsrfRejectedError,
  ForbiddenError,
  RateLimitedError,
  UnauthenticatedError,
} from '../errors/http-errors.js';
import type { AuthService } from '../services/auth.service.js';
import { parseRequest } from '../validators/parse-request.js';
import { clinicIdSchema } from '../validators/auth.js';

const safeMethods = new Set(['GET', 'HEAD', 'OPTIONS']);

export function requireBrowserRequest(req: Request, _res: Response, next: NextFunction) {
  if (safeMethods.has(req.method)) {
    next();
    return;
  }

  if (req.get(CARE_FLOW_REQUEST_HEADER) !== '1') {
    next(new CsrfRejectedError());
    return;
  }

  next();
}

export function createAuthenticate(auth: AuthService, nodeEnv: NodeEnv) {
  return async function authenticate(req: Request, res: Response, next: NextFunction) {
    const token = readCookie(req.headers.cookie, SESSION_COOKIE_NAME);
    if (!token) {
      next(new UnauthenticatedError());
      return;
    }

    try {
      const session = await auth.authenticate(token);
      if (!session) {
        clearSessionCookie(res, nodeEnv);
        next(new UnauthenticatedError());
        return;
      }
      req.auth = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createRequireCsrf(auth: AuthService) {
  return function requireCsrf(req: Request, _res: Response, next: NextFunction) {
    if (!req.auth) {
      next(new UnauthenticatedError());
      return;
    }

    const expected = auth.csrfTokenForSession(req.auth.sessionToken);
    if (!csrfTokensMatch(req.get(CSRF_HEADER), expected)) {
      next(new CsrfRejectedError());
      return;
    }

    next();
  };
}

export function createRequireClinicRole(auth: AuthService, allowed: readonly MembershipRole[]) {
  return async function requireClinicRole(req: Request, res: Response, next: NextFunction) {
    if (!req.auth) {
      next(new UnauthenticatedError());
      return;
    }

    try {
      const { clinicId } = parseRequest(clinicIdSchema, req.params);
      const access = await auth.clinicAccess(req.auth.user.id, clinicId, allowed);
      if (!access) {
        next(new ForbiddenError());
        return;
      }
      res.locals.clinicAccess = access;
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function createRateLimiter(options: { limit: number; windowMs: number }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = `${req.path}:${req.ip ?? req.socket.remoteAddress ?? 'unknown'}`;
    const current = hits.get(key);
    if (!current || current.resetAt <= now) {
      hits.set(key, { count: 1, resetAt: now + options.windowMs });
      next();
      return;
    }

    if (current.count >= options.limit) {
      const retryAfter = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      next(new RateLimitedError());
      return;
    }

    current.count += 1;
    next();
  };
}
