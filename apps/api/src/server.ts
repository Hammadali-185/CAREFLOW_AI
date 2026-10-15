import 'dotenv/config';
import { loadEnv } from './config/env.js';
import { createApp } from './app.js';
import { createMistralClient } from './modules/assistant/mistral.js';
import { createPrismaAssistantRepository } from './repositories/assistant.repository.js';
import { createPrismaAuthRepository } from './repositories/auth.repository.js';
import { PrismaHealthProbe } from './repositories/health.repository.js';
import { createPrismaClient } from './repositories/prisma.js';
import { createPrismaSchedulingRepository } from './repositories/scheduling.repository.js';
import { createAssistantService } from './services/assistant.service.js';
import { createAuthService } from './services/auth.service.js';
import { createSchedulingService } from './services/scheduling.service.js';
import { createLogger } from './utils/logger.js';

const env = readEnvironment();
const logger = createLogger(env.logLevel);
const prisma = createPrismaClient(env.databaseUrl);
const auth = createAuthService({
  repository: createPrismaAuthRepository(prisma),
  csrfSecret: env.csrfSecret,
});
const scheduling = createSchedulingService({
  repository: createPrismaSchedulingRepository(prisma),
});
const assistant = createAssistantService({
  repository: createPrismaAssistantRepository(prisma),
  scheduling,
  model: createMistralClient({
    apiKey: env.mistralApiKey,
    model: env.mistralModel,
    timeoutMs: env.mistralTimeoutMs,
  }),
  clinicAccess: (userId, clinicId, allowed) => auth.clinicAccess(userId, clinicId, allowed),
  logger,
});
const app = createApp({
  corsOrigins: env.corsOrigins,
  probe: new PrismaHealthProbe(prisma),
  logger,
  nodeEnv: env.nodeEnv,
  auth,
  scheduling,
  assistant,
});

const server = app.listen(env.port, '0.0.0.0', () => {
  logger.info('API listening', { url: `http://127.0.0.1:${env.port}` });
});

let shuttingDown = false;

function shutdown(signal: string) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  logger.info('Shutting down', { signal });

  server.close(() => {
    void prisma.$disconnect().finally(() => {
      process.exit(0);
    });
  });

  setTimeout(() => {
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

function readEnvironment() {
  try {
    return loadEnv(process.env);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid environment configuration.';
    console.error(message);
    process.exit(1);
  }
}
