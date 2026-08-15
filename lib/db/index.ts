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
 *
 *  - `max` MUST be greater than 1. This looks like the wrong instinct for
 *    serverless — "the pooler is the pool, so one connection is enough" — and
 *    that reasoning is what originally set it to 1. It deadlocks.
 *
 *    With a single connection, postgres.js pipelines concurrent queries down
 *    it, and Supavisor's transaction mode cannot service pipelined queries
 *    because it wants one transaction per connection. The result is not an
 *    error but a HANG: a single query is fine, so `/api/health` and `/jobs`
 *    look healthy while the Overview page (six queries via `Promise.all`)
 *    never returns. Measured against this exact database: `max: 1` exceeded
 *    20s and never completed; `max: 5` finished the same six queries in 0.28s.
 *
 *    Five is enough to serve the widest fan-out on any page while staying far
 *    below the free tier's client limit. Do not lower it to 1.
 *
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
    // See the note above — must be > 1 or concurrent queries deadlock.
    max: 8,
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
