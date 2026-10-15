import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';

export function createPrismaClient(
  databaseUrl: string,
  options?: { maxConnections?: number },
): PrismaClient {
  const maxConnections = options?.maxConnections ?? poolMaxFromEnv();
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ...(maxConnections ? { max: maxConnections } : {}),
  });
  const configured = new WeakSet<pg.PoolClient>();
  pool.on('error', () => {
    // An idle client can disconnect when a test database shuts down.
  });
  const connect = pool.connect.bind(pool);
  pool.connect = ((
    callback?: (
      error: Error | undefined,
      client: pg.PoolClient | undefined,
      release: () => void,
    ) => void,
  ) => {
    if (callback) {
      return connect((error, client, release) => {
        if (error || !client) {
          callback(error, client, release);
          return;
        }
        const connected = client;
        ensureUtc(connected, configured, (setError) => callback(setError, connected, release));
      });
    }
    return connect().then(async (client) => {
      await ensureUtc(client, configured);
      return client;
    });
  }) as typeof pool.connect;

  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

function ensureUtc(
  client: pg.PoolClient,
  configured: WeakSet<pg.PoolClient>,
  done?: (error: Error | undefined) => void,
) {
  if (configured.has(client)) {
    done?.(undefined);
    return Promise.resolve();
  }
  client.on('error', () => {
    // The pool handles checkout errors. Ignore a disconnect during shutdown.
  });
  const pending = client.query('SET TIME ZONE UTC').then(
    () => {
      configured.add(client);
    },
    (error: unknown) => {
      throw error instanceof Error ? error : new Error('Could not set the database time zone.');
    },
  );
  if (!done) {
    return pending;
  }
  pending.then(
    () => done(undefined),
    (error: unknown) =>
      done(error instanceof Error ? error : new Error('Could not set the database time zone.')),
  );
  return pending;
}

function poolMaxFromEnv() {
  const raw = process.env.PG_POOL_MAX;
  if (!raw) {
    return undefined;
  }
  const max = Number(raw);
  return Number.isInteger(max) && max > 0 ? max : undefined;
}
