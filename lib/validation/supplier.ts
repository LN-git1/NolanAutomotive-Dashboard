import { z } from 'zod';

import { decimalString, optionalText, requiredDate, requiredText, uuidString } from './common';

export const supplierInputSchema = z.object({
  name: requiredText('Supplier name', 200),
  notes: optionalText,
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const supplierBillInputSchema = z.object({
  supplierId: uuidString,
  // 8 integer digits is generous for a small garage's supplier bills (up to
  // ~€100m) while staying safely under the amount column's numeric(12,2) cap.
  amount: decimalString({ label: 'Amount', maxIntegerDigits: 8 }),
  billDate: requiredDate,
  reference: optionalText,
  notes: optionalText,
  attachmentStoragePath: optionalText,
});

export type SupplierBillInput = z.infer<typeof supplierBillInputSchema>;

export const billIdSchema = z.object({ billId: uuidString });
export const supplierIdSchema = z.object({ supplierId: uuidString });
