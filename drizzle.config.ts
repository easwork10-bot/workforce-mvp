import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';
import { requireDatabaseUrl } from './src/backend/db/databaseUrl';

loadEnvConfig(process.cwd());

export default defineConfig({
  schema: './src/backend/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: requireDatabaseUrl(process.env.DATABASE_URL),
  },
  verbose: true,
  strict: true,
});