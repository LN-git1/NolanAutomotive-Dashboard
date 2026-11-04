'use server';

import { and, count, eq, isNull } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { guardedWrite } from '@/lib/actions/safe';
import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { assignees, jobAssignees } from '@/lib/db/schema';
import { assigneeIdSchema, assigneeInputSchema } from '@/lib/validation/assignee';

export interface ActionResult {
  ok: boolean;
  error?: string;
  /** Set by `removeAssignee`: true when the person was archived rather than deleted. */
  archived?: boolean;
}

const ASSIGNEE_PATHS = ['/settings', '/jobs', '/earnings'] as const;

function refresh() {
  for (const path of ASSIGNEE_PATHS) revalidatePath(path);
}

/** Case-insensitive duplicate check among people still on the list. */
async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const rows = await db
    .select({ id: assignees.id, name: assignees.name })
    .from(assignees)
    .where(isNull(assignees.archivedAt));
  return rows.some((row) => row.id !== exceptId && row.name.toLowerCase() === name.toLowerCase());
}

export async function addAssignee(formData: FormData): Promise<ActionResult> {
  await requireSession();

  const parsed = assigneeInputSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name' };
  }

  return guardedWrite('addAssignee', async () => {
    if (await nameTaken(parsed.data.name)) {
      return { ok: false, error: `${parsed.data.name} is already on the list.` };
    }
    await db.insert(assignees).values({ name: parsed.data.name });
    refresh();
    return { ok: true };
  });
}

export async function renameAssignee(id: string, formData: FormData): Promise<ActionResult> {
  await requireSession();

  const idParsed = assigneeIdSchema.safeParse(id);
  const parsed = assigneeInputSchema.safeParse(Object.fromEntries(formData));
  if (!idParsed.success) return { ok: false, error: 'Invalid person' };
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid name' };
  }

  return guardedWrite('renameAssignee', async () => {
    if (await nameTaken(parsed.data.name, idParsed.data)) {
      return { ok: false, error: `${parsed.data.name} is already on the list.` };
    }
    const updated = await db
      .update(assignees)
      .set({ name: parsed.data.name })
      .where(and(eq(assignees.id, idParsed.data), isNull(assignees.archivedAt)))
      .returning({ id: assignees.id });
    if (updated.length === 0) return { ok: false, error: 'That person is no longer on the list.' };
    refresh();
    return { ok: true };
  });
}

/**
 * Delete someone with no history; archive someone who has been on a job, so
 * their past jobs and earnings keep a name (see the note on `assignees`).
 */
export async function removeAssignee(id: string): Promise<ActionResult> {
  await requireSession();

  const parsed = assigneeIdSchema.safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Invalid person' };

  return guardedWrite('removeAssignee', async () => {
    const [usage] = await db
      .select({ jobs: count() })
      .from(jobAssignees)
      .where(eq(jobAssignees.assigneeId, parsed.data));

    if ((usage?.jobs ?? 0) === 0) {
      await db.delete(assignees).where(eq(assignees.id, parsed.data));
      refresh();
      return { ok: true, archived: false };
    }

    await db
      .update(assignees)
      .set({ archivedAt: new Date() })
      .where(eq(assignees.id, parsed.data));
    refresh();
    return { ok: true, archived: true };
  });
}
