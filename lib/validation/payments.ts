import { z } from 'zod';

import { decimalString, uuidString } from './common';

export const invoiceIdSchema = z.object({ invoiceId: uuidString });

/**
 * 8 integer digits, matching the cap already applied to supplier bill
 * amounts — generous for a single payment while staying safely under the
 * `payments.amount` column's `numeric(12,2)` limit.
 */
export const paymentAmountSchema = decimalString({ label: 'Amount', maxIntegerDigits: 8 });
