import 'dotenv/config';
import { defineConfig } from 'prisma/config';

const localDatabaseUrl = 'postgresql://careflow:careflow@127.0.0.1:5432/careflow?schema=public';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Prisma CLI loads this file for generate, which does not need a live database.
    // The API process refuses to start unless DATABASE_URL is set. See src/config/env.ts.
    url: process.env.DATABASE_URL ?? localDatabaseUrl,
  },
});
