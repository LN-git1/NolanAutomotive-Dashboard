import { z } from 'zod';

import { decimalString, optionalText, requiredDate, requiredText, uuidString } from './common';

export const supplierInputSchema = z.object({
  name: requiredText('Supplier name', 200),
  notes: optionalText,
});

export type SupplierInput = z.infer<typeof supplierInputSchema>;

export const supplierBillInputSchema = z.object({
  supplierId: uuidString,
  amount: decimalString({ label: 'Amount' }),
  billDate: requiredDate,
  reference: optionalText,
  notes: optionalText,
  attachmentStoragePath: optionalText,
});

export type SupplierBillInput = z.infer<typeof supplierBillInputSchema>;

export const billIdSchema = z.object({ billId: uuidString });
export const supplierIdSchema = z.object({ supplierId: uuidString });
