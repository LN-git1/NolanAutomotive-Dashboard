import { z } from 'zod';

import { uuidString } from './common';

/**
 * The invoice payload is now just a job reference.
 *
 * Everything that used to travel in this body — work carried out, labour, parts,
 * comments — lives on the job and is read server-side at build time. That is
 * what makes an invoice re-generatable: there is no client-supplied content that
 * could differ from what the job says.
 */
export const invoiceDraftSchema = z.object({
  jobId: uuidString,
});

export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

export const sentViaSchema = z.enum(['email', 'whatsapp', 'share']);

export const invoiceFinalizeSchema = invoiceDraftSchema.extend({
  sentVia: sentViaSchema,
});

export type InvoiceFinalizeInput = z.infer<typeof invoiceFinalizeSchema>;

/** Re-sending an existing invoice: same number, freshly stamped from the job. */
export const invoiceRegenerateSchema = z.object({
  sentVia: sentViaSchema,
});

export const invoiceVoidSchema = z.object({
  reason: z.string().trim().max(300).optional(),
});
