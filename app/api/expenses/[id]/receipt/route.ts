import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { expenses } from '@/lib/db/schema';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { DOWNLOAD_TTL_SECONDS, createSignedDownloadUrl } from '@/lib/storage/signedUrl';

export const runtime = 'nodejs';

/**
 * Open the receipt attached to an expense.
 *
 * Same shape as `/api/supplier-bills/[id]/receipt` — redirect to a
 * short-lived signed URL rather than streaming the bytes through this
 * function, so View is a plain `<a href>` link that cannot be popup-blocked
 * in the installed PWA.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const { id } = await params;

  const rows = await db.select().from(expenses).where(eq(expenses.id, id)).limit(1);
  const expense = rows[0];

  if (!expense) {
    return Response.json({ error: 'Expense not found' }, { status: 404 });
  }

  if (!expense.receiptStoragePath) {
    return Response.json({ error: 'This expense has no receipt attached' }, { status: 404 });
  }

  try {
    const url = await createSignedDownloadUrl(
      ATTACHMENTS_BUCKET,
      expense.receiptStoragePath,
      DOWNLOAD_TTL_SECONDS,
    );

    return NextResponse.redirect(url, 307);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not open the receipt' },
      { status: 500 },
    );
  }
}
