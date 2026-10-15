import { CARE_FLOW_REQUEST_HEADER, CSRF_HEADER, IDEMPOTENCY_HEADER } from '@careflow/shared';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { NodeEnv } from './config/env.js';
import { createAssistantController } from './controllers/assistant.controller.js';
import { createAuthController } from './controllers/auth.controller.js';
import { createClinicController } from './controllers/clinic.controller.js';
import { createHealthController } from './controllers/health.controller.js';
import { createSchedulingController } from './controllers/scheduling.controller.js';
import { errorHandler } from './middleware/error-handler.js';
import { notFoundHandler } from './middleware/not-found.js';
import { requestLogger } from './middleware/request-logger.js';
import { requireBrowserRequest } from './middleware/security.js';
import type { DatabaseProbe } from './repositories/database-probe.js';
import { createApiRouter } from './routes/index.js';
import type { AssistantService } from './services/assistant.service.js';
import type { AuthService } from './services/auth.service.js';
import type { SchedulingService } from './services/scheduling.service.js';
import { createHealthService } from './services/health.service.js';
import './types/express.js';
import type { Logger } from './utils/logger.js';

export type CreateAppOptions = {
  corsOrigins: readonly string[];
  probe: DatabaseProbe;
  logger: Logger;
  nodeEnv: NodeEnv;
  auth: AuthService;
  scheduling: SchedulingService;
  assistant: AssistantService;
  authRateLimit?: { limit: number; windowMs: number };
};

export function createApp(options: CreateAppOptions) {
  const app = express();
  const healthController = createHealthController(createHealthService(options.probe));
  const authController = createAuthController(options.auth, options.nodeEnv);
  const clinicController = createClinicController();
  const schedulingController = createSchedulingController(options.scheduling);
  const assistantController = createAssistantController(options.assistant);

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(helmet());
  app.use(requestLogger(options.logger));
  app.use(
    cors({
      origin: [...options.corsOrigins],
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Accept',
        CARE_FLOW_REQUEST_HEADER,
        CSRF_HEADER,
        IDEMPOTENCY_HEADER,
      ],
      credentials: true,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use('/api', requireBrowserRequest);
  app.use(
    '/api',
    createApiRouter({
      healthController,
      authController,
      clinicController,
      schedulingController,
      assistantController,
      auth: options.auth,
      nodeEnv: options.nodeEnv,
      authRateLimit: options.authRateLimit ?? { limit: 10, windowMs: 15 * 60 * 1000 },
    }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler(options.nodeEnv, options.logger));

  return app;
}
