import { Router } from 'express';
import type { AssistantController } from '../controllers/assistant.controller.js';
import type { AuthController } from '../controllers/auth.controller.js';
import type { ClinicController } from '../controllers/clinic.controller.js';
import type { HealthController } from '../controllers/health.controller.js';
import type { SchedulingController } from '../controllers/scheduling.controller.js';
import type { NodeEnv } from '../config/env.js';
import type { AuthService } from '../services/auth.service.js';
import { createAssistantRouter } from './assistant.routes.js';
import { createAuthRouter } from './auth.routes.js';
import { createClinicRouter } from './clinic.routes.js';
import { createHealthRouter } from './health.routes.js';
import { createSchedulingRouter } from './scheduling.routes.js';

export function createApiRouter(options: {
  healthController: HealthController;
  authController: AuthController;
  clinicController: ClinicController;
  schedulingController: SchedulingController;
  assistantController: AssistantController;
  auth: AuthService;
  nodeEnv: NodeEnv;
  authRateLimit: { limit: number; windowMs: number };
}) {
  const router = Router();
  router.use(createHealthRouter(options.healthController));
  router.use(
    createAuthRouter(options.authController, options.auth, options.nodeEnv, options.authRateLimit),
  );
  router.use(createClinicRouter(options.clinicController, options.auth, options.nodeEnv));
  router.use(createSchedulingRouter(options.schedulingController, options.auth, options.nodeEnv));
  router.use(createAssistantRouter(options.assistantController, options.auth, options.nodeEnv));
  return router;
}
