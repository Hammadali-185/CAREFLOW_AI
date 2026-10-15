import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { btree_gist } from '@electric-sql/pglite/contrib/btree_gist';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const databasePort = 55445;
const apiPort = 4010;
const migrations = [
  'apps/api/prisma/migrations/20261014120000_init/migration.sql',
  'apps/api/prisma/migrations/20261014210000_domain_model/migration.sql',
  'apps/api/prisma/migrations/20261014223000_appointment_idempotency/migration.sql',
  'apps/api/prisma/migrations/20261015010000_chat_workflow_state/migration.sql',
];

const database = new PGlite({ extensions: { btree_gist } });
for (const file of migrations) {
  await database.exec(readFileSync(path.join(root, file), 'utf8'));
}
await database.exec(readFileSync(path.join(root, 'database/seed.sql'), 'utf8'));

const socket = new PGLiteSocketServer({ db: database, port: databasePort, host: '127.0.0.1' });
await socket.start();

const env = { ...process.env };
delete env.MISTRAL_API_KEY;
env.NODE_ENV = 'development';
env.PORT = String(apiPort);
env.DATABASE_URL = `postgresql://postgres:postgres@127.0.0.1:${databasePort}/postgres?sslmode=disable`;
env.CORS_ORIGIN = 'http://127.0.0.1:5174';
env.CSRF_SECRET = 'e2e-csrf-secret-that-is-long-enough';
env.LOG_LEVEL = 'warn';
env.PG_POOL_MAX = '1';

const api = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
  cwd: path.join(root, 'apps/api'),
  env,
  stdio: 'inherit',
});

let stopping = false;

async function stop() {
  if (stopping) {
    return;
  }
  stopping = true;
  api.kill();
  await socket.stop();
  process.exit(0);
}

api.on('exit', (code) => {
  if (!stopping) {
    console.error(`e2e api exited (${code ?? 'unknown'})`);
    process.exit(code ?? 1);
  }
});

process.on('SIGINT', () => {
  void stop();
});
process.on('SIGTERM', () => {
  void stop();
});
