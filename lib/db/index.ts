import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * Runtime database client.
 *
 * Uses the POOLED Supabase connection (Supavisor, port 6543). Two consequences
 * that are easy to get wrong:
 *
 *  - `prepare: false` is mandatory. Transaction-mode pooling hands a different
 *    backend connection to each statement, so server-side prepared statements
 *    break with "prepared statement already exists".
 *  - Migrations must NOT use this client. They use DIRECT_DATABASE_URL (port
 *    5432) via `lib/db/migrate.ts` for the same reason.
 *
 * The client is cached on globalThis so Next.js dev hot-reload does not open a
 * new pool on every recompile.
 */

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env.local and fill in the pooled Supabase connection string.',
  );
}

const globalForDb = globalThis as unknown as {
  __nolanSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__nolanSql ??
  postgres(connectionString, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.__nolanSql = sql;
}

export const db = drizzle(sql, { schema });
export { sql };
export type Database = typeof db;
