import { z } from 'zod';

import { decimalString, optionalText, uuidString } from './common';

export const partLineSchema = z.object({
  partName: z.string().trim().min(1, 'Part name is required').max(200),
  partNumber: z.string().trim().max(60).default(''),
  qty: decimalString({ label: 'Quantity' }),
  unitPrice: decimalString({ label: 'Unit price' }),
});

export type PartLineInput = z.infer<typeof partLineSchema>;

/**
 * Payload shared by the preview (`/api/invoices/generate`) and the committing
 * call (`/api/invoices/finalize`). Both accept identical invoice content; only
 * finalize additionally requires `sentVia`.
 */
export const invoiceDraftSchema = z.object({
  jobId: uuidString,
  workCarriedOut: optionalText,
  labourHours: decimalString({ label: 'Labour hours', allowEmpty: true }),
  hourlyRate: decimalString({ label: 'Hourly rate', allowEmpty: true }),
  parts: z.array(partLineSchema).max(50).default([]),
  otherComments: optionalText,
});

export type InvoiceDraft = z.infer<typeof invoiceDraftSchema>;

export const sentViaSchema = z.enum(['email', 'whatsapp', 'share']);

export const invoiceFinalizeSchema = invoiceDraftSchema.extend({
  sentVia: sentViaSchema,
});

export type InvoiceFinalizeInput = z.infer<typeof invoiceFinalizeSchema>;
