'use server';

import { eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { guardedWrite } from '@/lib/actions/safe';
import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { timeOff } from '@/lib/db/schema';
import { timeOffIdSchema, timeOffInputSchema } from '@/lib/validation/time-off';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const TIME_OFF_PATHS = ['/settings', '/schedule', '/'] as const;

export async function addTimeOff(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = timeOffInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid time off details' };
  }

  return guardedWrite('addTimeOff', async () => {
    await db.insert(timeOff).values(parsed.data);

    for (const path of TIME_OFF_PATHS) revalidatePath(path);
    return { ok: true };
  });
}

export async function deleteTimeOff(id: string): Promise<ActionResult> {
  await requireSession();

  const parsed = timeOffIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Invalid time off entry' };

  return guardedWrite('deleteTimeOff', async () => {
    await db.delete(timeOff).where(eq(timeOff.id, parsed.data));

    for (const path of TIME_OFF_PATHS) revalidatePath(path);
    return { ok: true };
  });
}
