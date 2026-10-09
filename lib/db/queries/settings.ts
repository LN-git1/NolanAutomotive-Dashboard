import 'server-only';

import { eq } from 'drizzle-orm';

import { db } from '../index';
import { withDbRetry } from '../retry';
import { settings, type Settings } from '../schema';

export const SETTINGS_ID = 1;

/**
 * The settings singleton.
 *
 * Falls back to an in-memory default rather than throwing when the row is
 * missing, so a forgotten `pnpm db:seed` degrades to sensible defaults instead
 * of a 500 on every page. The seed script is still the supported path.
 */
export async function getSettings(): Promise<Settings> {
  const rows = await withDbRetry('settings:get', () =>
    db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1),
  );
  const existing = rows[0];
  if (existing) {
    return {
      ...existing,
      timeFormat: existing.timeFormat ?? '12h',
    };
  }

  const now = new Date();
  return {
    id: SETTINGS_ID,
    businessName: 'Nolan Automotive',
    businessAddress: null,
    businessPhone: null,
    businessEmail: null,
    vatRegistered: false,
    vatNumber: null,
    defaultVatRate: '23.00',
    defaultHourlyRate: null,
    timeFormat: '12h',
    createdAt: now,
    updatedAt: now,
  };
}
