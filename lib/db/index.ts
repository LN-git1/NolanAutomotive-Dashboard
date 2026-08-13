import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

/**
 * Runtime database client.
 *
 * Uses the POOLED Supabase connection (Supavisor, port 6543). Three things here
 * are deliberate and easy to get wrong:
 *
 *  - `prepare: false` is mandatory. Transaction-mode pooling hands a different
 *    backend connection to each statement, so server-side prepared statements
 *    break with "prepared statement already exists".
 *  - `max: 1`. The pooler IS the pool. Each serverless instance opening ten
 *    connections would mean hundreds of pooler clients under concurrency, well
 *    past the free tier's limit.
 *  - Migrations must NOT use this client. They use DIRECT_DATABASE_URL
 *    (port 5432) via `scripts/migrate.ts`, for the same pooling reason.
 */

function createDb() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill in the pooled connection string.',
    );
  }

  const sql = postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
  });

  return drizzle(sql, { schema });
}

type Db = ReturnType<typeof createDb>;

const globalForDb = globalThis as unknown as { __nolanDb?: Db };

function getDb(): Db {
  // Cached on globalThis so Next.js dev hot-reload does not open a new pool on
  // every recompile.
  return (globalForDb.__nolanDb ??= createDb());
}

/**
 * Lazy on purpose. `next build` imports these modules to collect route config,
 * and a module-scope throw here would fail the build outright whenever
 * DATABASE_URL is absent from the build environment — which is exactly what
 * happens on a Preview deployment if the variable was only scoped to
 * Production.
 *
 * Note that wrapping the connection in a function is NOT sufficient on its own:
 * `export const db = drizzle(getSql(), …)` still runs at import. The laziness
 * has to reach this export, hence the proxy — every call site touches `db`
 * through a property read (`db.select`, `db.transaction`, `db.query.jobs`), so
 * nothing connects or throws until a query is actually run.
 */
export const db = new Proxy({} as Db, {
  get: (_target, prop, receiver) => Reflect.get(getDb(), prop, receiver),
});

export type Database = Db;
