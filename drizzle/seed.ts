/**
 * Initialise the rows the application cannot run without.
 *
 *   pnpm db:seed
 *
 * Idempotent — safe to re-run. It never overwrites existing values, so running
 * it against a live database will not reset the invoice counter or clobber the
 * owner's saved settings.
 */

import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from '../lib/db/schema';

async function main() {
  const url = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;

  if (!url) {
    throw new Error('DIRECT_DATABASE_URL (or DATABASE_URL) must be set to seed the database.');
  }

  const client = postgres(url, { prepare: false, max: 1 });
  const db = drizzle(client, { schema });

  try {
    // The two counters. Both start at 1 and only ever move forward.
    await db.execute(sql`
      INSERT INTO counters (key, next_value)
      VALUES ('invoice', 1), ('job', 1)
      ON CONFLICT (key) DO NOTHING
    `);

    // The settings singleton. Pinned to id = 1 by convention.
    await db.execute(sql`
      INSERT INTO settings (id, business_name, business_address, business_phone, vat_registered, default_vat_rate)
      VALUES (1, 'Nolan Automotive', 'Ballybrack, Kilcock, Naas, Co. Kildare, W23 AWV1', '(085) 149-5591', false, '23.00')
      ON CONFLICT (id) DO NOTHING
    `);

    const counters = await db.execute(sql`SELECT key, next_value FROM counters ORDER BY key`);
    console.log('Seed complete. Counters:', counters);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
