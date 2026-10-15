import { Router } from 'express';
import type { AssistantController } from '../controllers/assistant.controller.js';
import type { NodeEnv } from '../config/env.js';
import {
  createAuthenticate,
  createRequireClinicRole,
  createRequireCsrf,
} from '../middleware/security.js';
import type { AuthService } from '../services/auth.service.js';

export function createAssistantRouter(
  controller: AssistantController,
  auth: AuthService,
  nodeEnv: NodeEnv,
) {
  const router = Router();
  const authenticate = createAuthenticate(auth, nodeEnv);
  const requireCsrf = createRequireCsrf(auth);
  const patients = createRequireClinicRole(auth, ['patient']);

  router.get('/clinics/:clinicId/assistant/sessions', authenticate, patients, (req, res, next) => {
    controller.list(req, res).catch(next);
  });
  router.post(
    '/clinics/:clinicId/assistant/sessions',
    authenticate,
    requireCsrf,
    patients,
    (req, res, next) => {
      controller.create(req, res).catch(next);
    },
  );
  router.get('/assistant/sessions/:sessionId', authenticate, (req, res, next) => {
    controller.get(req, res).catch(next);
  });
  router.post(
    '/assistant/sessions/:sessionId/messages',
    authenticate,
    requireCsrf,
    (req, res, next) => {
      controller.postMessage(req, res).catch(next);
    },
  );
  router.post(
    '/assistant/sessions/:sessionId/slots',
    authenticate,
    requireCsrf,
    (req, res, next) => {
      controller.selectSlot(req, res).catch(next);
    },
  );
  router.post(
    '/assistant/sessions/:sessionId/confirm',
    authenticate,
    requireCsrf,
    (req, res, next) => {
      controller.confirm(req, res).catch(next);
    },
  );
  return router;
}
