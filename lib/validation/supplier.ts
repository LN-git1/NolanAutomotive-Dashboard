import { z } from 'zod';

import { decimalString, optionalText, requiredDate, requiredText, uuidString } from './common';

export const supplierInputSchema = z.object({
  name: requiredText('Supplier name', 200),
  notes: optionalText,
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

/**
 * A purchase going onto a supplier's account. Payments coming off it are not
 * validated here: they carry an amount and nothing else, so they reuse
 * `supplierPaymentAmountSchema` below rather than a whole form schema.
 */
export const supplierChargeInputSchema = z.object({
  supplierId: uuidString,
  // 8 integer digits is generous for a small garage's supplier purchases (up
  // to ~€100m) while staying safely under the amount column's numeric(12,2) cap.
  amount: decimalString({ label: 'Amount', maxIntegerDigits: 8 }),
  entryDate: requiredDate,
  reference: optionalText,
  notes: optionalText,
  attachmentStoragePath: optionalText,
});

export type SupplierChargeInput = z.infer<typeof supplierChargeInputSchema>;

/** Same cap as a charge — the two sides of one account must agree on range. */
export const supplierPaymentAmountSchema = decimalString({
  label: 'Amount',
  maxIntegerDigits: 8,
});

export const supplierEntryIdSchema = z.object({ entryId: uuidString });
export const supplierIdSchema = z.object({ supplierId: uuidString });
