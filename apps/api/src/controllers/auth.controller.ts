import { loginRequestSchema, signupRequestSchema } from '@careflow/shared';
import type { Request, Response } from 'express';
import { clearSessionCookie, readCookie, setSessionCookie } from '../modules/auth/cookies.js';
import { SESSION_COOKIE_NAME } from '../modules/auth/tokens.js';
import type { NodeEnv } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';
import { parseRequest } from '../validators/parse-request.js';

export function createAuthController(auth: AuthService, nodeEnv: NodeEnv) {
  return {
    async signup(req: Request, res: Response) {
      const body = parseRequest(signupRequestSchema, req.body);
      const issued = await auth.signup(body, readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
      setSessionCookie(res, issued.token, nodeEnv);
      res.status(201).json({ user: issued.user, csrfToken: issued.csrfToken });
    },

    async login(req: Request, res: Response) {
      const body = parseRequest(loginRequestSchema, req.body);
      const issued = await auth.login(body, readCookie(req.headers.cookie, SESSION_COOKIE_NAME));
      setSessionCookie(res, issued.token, nodeEnv);
      res.status(200).json({ user: issued.user, csrfToken: issued.csrfToken });
    },

    async logout(req: Request, res: Response) {
      if (req.auth) {
        await auth.logout(req.auth.sessionToken);
      }
      clearSessionCookie(res, nodeEnv);
      res.status(204).send();
    },

    me(req: Request, res: Response) {
      if (!req.auth) {
        res.status(401).json({
          error: { code: 'UNAUTHENTICATED', message: 'Sign in to continue.' },
        });
        return;
      }
      res.status(200).json({
        user: req.auth.user,
        csrfToken: auth.csrfTokenForSession(req.auth.sessionToken),
      });
    },
  };
}

export type AuthController = ReturnType<typeof createAuthController>;
