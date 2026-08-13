/**
 * Apply pending migrations to a database.
 *
 *   pnpm db:migrate:prod
 *
 * Uses DIRECT_DATABASE_URL — the direct connection on port 5432, never the
 * pooler on 6543. Supabase's pooler runs in transaction mode and hands each
 * statement a different backend connection, which breaks both DDL and the
 * prepared statements the migrator relies on.
 *
 * Reads its credentials from `.env.production.local` (gitignored) via
 * `tsx --env-file`, so no production secret is ever typed into a shell or left
 * in shell history.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

async function main() {
  const url = process.env.DIRECT_DATABASE_URL;

  if (!url) {
    throw new Error(
      'DIRECT_DATABASE_URL is not set. Use the DIRECT Supabase connection string (port 5432), ' +
        'not the pooled one, and put it in .env.production.local.',
    );
  }

  if (url.includes(':6543')) {
    throw new Error(
      'DIRECT_DATABASE_URL points at the pooler (port 6543). Migrations must use the direct ' +
        'connection on port 5432 or they will fail partway through.',
    );
  }

  const client = postgres(url, { max: 1, prepare: false });

  try {
    await migrate(drizzle(client), { migrationsFolder: './drizzle/migrations' });
    console.log('Migrations applied.');
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
