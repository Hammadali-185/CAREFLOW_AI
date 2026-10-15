import { Router } from 'express';
import type { AuthController } from '../controllers/auth.controller.js';
import {
  createAuthenticate,
  createRateLimiter,
  createRequireCsrf,
} from '../middleware/security.js';
import type { NodeEnv } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';

export function createAuthRouter(
  controller: AuthController,
  auth: AuthService,
  nodeEnv: NodeEnv,
  rateLimit: { limit: number; windowMs: number },
) {
  const router = Router();
  const authenticate = createAuthenticate(auth, nodeEnv);
  const requireCsrf = createRequireCsrf(auth);
  const limitSignup = createRateLimiter(rateLimit);
  const limitLogin = createRateLimiter(rateLimit);

  router.post('/auth/signup', limitSignup, (req, res, next) => {
    controller.signup(req, res).catch(next);
  });
  router.post('/auth/login', limitLogin, (req, res, next) => {
    controller.login(req, res).catch(next);
  });
  router.post('/auth/logout', authenticate, requireCsrf, (req, res, next) => {
    controller.logout(req, res).catch(next);
  });
  router.get('/auth/me', authenticate, (req, res, next) => {
    try {
      controller.me(req, res);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
