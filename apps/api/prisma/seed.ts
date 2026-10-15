import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import { Client } from 'pg';

const SCHEMA_VERSION = '2.0.0';

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required to seed the database. Copy apps/api/.env.example to apps/api/.env.',
    );
  }

  const seedPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../../database/seed.sql');
  const sql = readFileSync(seedPath, 'utf8');
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    await client.query(sql);
    const result = await client.query<{ version: string }>(
      'SELECT "version" FROM "schema_meta" WHERE "id" = 1',
    );
    const version = result.rows[0]?.version;
    if (version !== SCHEMA_VERSION) {
      throw new Error(`Seed finished, but schema_meta.version is ${version ?? 'missing'}.`);
    }
  } finally {
    await client.end();
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Database seed failed.';
  console.error(message);
  process.exit(1);
});
