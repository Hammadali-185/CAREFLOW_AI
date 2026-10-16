import { z } from 'zod';
import type { LogLevel } from '../utils/logger.js';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required.'),
  CORS_ORIGIN: z.string().min(1, 'CORS_ORIGIN is required.'),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters.'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  MISTRAL_API_KEY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().min(1).optional(),
  ),
  MISTRAL_MODEL: z.string().min(1).default('ministral-3b-latest'),
  MISTRAL_TIMEOUT_MS: z.coerce.number().int().positive().max(60_000).default(20_000),
});

export type NodeEnv = z.infer<typeof envSchema>['NODE_ENV'];

export type AppEnv = {
  nodeEnv: NodeEnv;
  port: number;
  databaseUrl: string;
  corsOrigins: readonly string[];
  csrfSecret: string;
  logLevel: LogLevel;
  mistralApiKey: string | undefined;
  mistralModel: string;
  mistralTimeoutMs: number;
};

export function loadEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    throw new Error(`Invalid environment configuration:\n${formatIssues(parsed.error)}`);
  }

  if (!/^postgres(ql)?:\/\//i.test(parsed.data.DATABASE_URL)) {
    throw new Error(
      'Invalid environment configuration:\nDATABASE_URL: must be a PostgreSQL connection string.',
    );
  }

  return {
    nodeEnv: parsed.data.NODE_ENV,
    port: parsed.data.PORT,
    databaseUrl: parsed.data.DATABASE_URL,
    corsOrigins: parseCorsOrigins(parsed.data.CORS_ORIGIN),
    csrfSecret: parsed.data.CSRF_SECRET,
    logLevel: parsed.data.LOG_LEVEL,
    mistralApiKey: parsed.data.MISTRAL_API_KEY,
    mistralModel: parsed.data.MISTRAL_MODEL,
    mistralTimeoutMs: parsed.data.MISTRAL_TIMEOUT_MS,
  };
}

function parseCorsOrigins(value: string): string[] {
  if (value.includes('*')) {
    throw new Error(
      'Invalid environment configuration:\nCORS_ORIGIN: list explicit origins. A wildcard is not allowed.',
    );
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (origins.length === 0) {
    throw new Error(
      'Invalid environment configuration:\nCORS_ORIGIN: at least one origin is required.',
    );
  }

  return origins.map(parseHttpOrigin);
}

function parseHttpOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      `Invalid environment configuration:\nCORS_ORIGIN: "${value}" is not an absolute URL.`,
    );
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(
      `Invalid environment configuration:\nCORS_ORIGIN: "${value}" must use http or https.`,
    );
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error(
      `Invalid environment configuration:\nCORS_ORIGIN: "${value}" must be an origin without a path, query, or credentials.`,
    );
  }

  return url.origin;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'environment';
      return `${path}: ${issue.message}`;
    })
    .join('\n');
}
