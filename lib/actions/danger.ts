'use server';

import { sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

import { requireSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { invoices, jobAttachments, jobs, supplierBills, suppliers } from '@/lib/db/schema';
import { removeObjects } from '@/lib/storage/signedUrl';
import { ATTACHMENTS_BUCKET, INVOICES_BUCKET } from '@/lib/storage/supabaseAdmin';
import { RESET_CONFIRMATION_PHRASE } from '@/lib/validation/danger';

/**
 * Factory reset.
 *
 * Intended for clearing test data before the business starts using the
 * dashboard for real. It is destructive and not recoverable, so it is gated on
 * the owner typing an exact phrase, which is re-checked here on the server —
 * the client-side prompt is a speed bump, not the control.
 *
 * IMPORTANT — invoice numbering. This resets the invoice counter to 1, so the
 * next invoice issued will be NA-<year>-0001 again. That is what makes it a
 * genuine factory reset, but it means running this AFTER real invoices have
 * gone out to customers would produce duplicate invoice numbers, which Irish
 * Revenue would treat as a broken sequence. The UI states this plainly.
 *
 * Settings are deliberately NOT cleared: business name, VAT registration and
 * the default hourly rate are configuration, not data, and wiping them would
 * just mean retyping them.
 */

export interface ResetResult {
  ok: boolean;
  error?: string;
  deleted?: {
    jobs: number;
    invoices: number;
    attachments: number;
    suppliers: number;
    supplierBills: number;
    filesRemoved: number;
  };
}

export async function factoryReset(confirmation: string): Promise<ResetResult> {
  await requireSession();

  if (confirmation.trim() !== RESET_CONFIRMATION_PHRASE) {
    return {
      ok: false,
      error: `Type ${RESET_CONFIRMATION_PHRASE} exactly to confirm.`,
    };
  }

  try {
    // Collect the storage paths BEFORE the rows are deleted, otherwise the
    // files become unreachable orphans with nothing pointing at them.
    const [attachmentRows, invoiceRows, billRows] = await Promise.all([
      db.select({ path: jobAttachments.storagePath }).from(jobAttachments),
      db.select({ path: invoices.pdfStoragePath }).from(invoices),
      db.select({ path: supplierBills.attachmentStoragePath }).from(supplierBills),
    ]);

    const counts = await db.transaction(async (tx) => {
      /**
       * Order matters. `invoices` references `jobs` without ON DELETE CASCADE
       * — that is deliberate, so an issued invoice can never be silently
       * orphaned by deleting its job — which means invoices must go first.
       * Attachments and bills would cascade, but they are deleted explicitly
       * so the reported counts are accurate.
       */
      const deletedInvoices = await tx.delete(invoices).returning({ id: invoices.id });
      const deletedAttachments = await tx.delete(jobAttachments).returning({ id: jobAttachments.id });
      const deletedJobs = await tx.delete(jobs).returning({ id: jobs.id });
      const deletedBills = await tx.delete(supplierBills).returning({ id: supplierBills.id });
      const deletedSuppliers = await tx.delete(suppliers).returning({ id: suppliers.id });

      // Back to a fresh sequence: the next job is J-0001 and the next invoice
      // is NA-<year>-0001.
      await tx.execute(sql`
        UPDATE counters SET next_value = 1, updated_at = now() WHERE key IN ('invoice', 'job')
      `);

      return {
        jobs: deletedJobs.length,
        invoices: deletedInvoices.length,
        attachments: deletedAttachments.length,
        suppliers: deletedSuppliers.length,
        supplierBills: deletedBills.length,
      };
    });

    // Files last, and best-effort: the rows are already gone, so failing here
    // would leave the reset half-reported for the sake of an orphaned object.
    let filesRemoved = 0;
    filesRemoved += await removeObjects(
      ATTACHMENTS_BUCKET,
      [...attachmentRows, ...billRows].map((row) => row.path).filter((p): p is string => Boolean(p)),
    );
    filesRemoved += await removeObjects(
      INVOICES_BUCKET,
      invoiceRows.map((row) => row.path).filter(Boolean),
    );

    for (const path of ['/', '/jobs', '/invoicer', '/awaiting-payments', '/suppliers', '/settings']) {
      revalidatePath(path);
    }

    return { ok: true, deleted: { ...counts, filesRemoved } };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : 'The reset could not be completed.',
    };
  }
}
