import { defineConfig } from 'drizzle-kit';

/**
 * Migrations use the DIRECT connection (port 5432), never the pooled one.
 *
 * Supabase's pooler runs in transaction mode, which hands each statement a
 * different backend connection. DDL and the prepared statements drizzle-kit
 * relies on break under that. `DATABASE_URL` (pooled, 6543) is for runtime
 * queries only — see `lib/db/index.ts`.
 */

const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    'DIRECT_DATABASE_URL is not set. Use the DIRECT Supabase connection string (port 5432) for migrations.',
  );
}

export default defineConfig({
  schema: './lib/db/schema.ts',
  out: './drizzle/migrations',
  dialect: 'postgresql',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
