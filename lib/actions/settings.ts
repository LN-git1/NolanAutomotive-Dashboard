'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { settings } from '@/lib/db/schema';
import { SETTINGS_ID } from '@/lib/db/queries/settings';
import { settingsInputSchema } from '@/lib/validation/settings';

import type { ActionResult } from './jobs';

/**
 * Upsert the settings singleton. Uses ON CONFLICT so the page works even if the
 * seed was never run — the first save creates the row.
 */
export async function updateSettings(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = settingsInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid settings' };
  }

  const values = {
    id: SETTINGS_ID,
    ...parsed.data,
    defaultHourlyRate: parsed.data.defaultHourlyRate === '' ? null : parsed.data.defaultHourlyRate,
    updatedAt: new Date(),
  };

  try {
    await db
      .insert(settings)
      .values(values)
      .onConflictDoUpdate({
        target: settings.id,
        set: {
          businessName: sql`excluded.business_name`,
          businessAddress: sql`excluded.business_address`,
          businessPhone: sql`excluded.business_phone`,
          businessEmail: sql`excluded.business_email`,
          vatRegistered: sql`excluded.vat_registered`,
          vatNumber: sql`excluded.vat_number`,
          defaultVatRate: sql`excluded.default_vat_rate`,
          defaultHourlyRate: sql`excluded.default_hourly_rate`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Could not save settings' };
  }

  revalidatePath('/settings');
  revalidatePath('/invoicer');
  return { ok: true };
}
