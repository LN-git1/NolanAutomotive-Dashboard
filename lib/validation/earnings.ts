import { z } from 'zod';

export const earningsMonthKeySchema = z.object({
  monthKey: z.string().regex(/^\d{4}-\d{2}$/, 'Invalid month'),
});
