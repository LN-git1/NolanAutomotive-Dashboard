import { z } from 'zod';

import { optionalText, requiredDate, uuidString } from './common';

/**
 * `startDate <= endDate` compares correctly as plain strings here because
 * both are enforced `YYYY-MM-DD` by `requiredDate` — lexicographic order is
 * chronological order for a zero-padded ISO date.
 */
export const timeOffInputSchema = z
  .object({
    startDate: requiredDate,
    endDate: requiredDate,
    label: optionalText,
  })
  .refine((value) => value.startDate <= value.endDate, {
    message: 'End date must be on or after the start date',
    path: ['endDate'],
  });

export type TimeOffInput = z.infer<typeof timeOffInputSchema>;

export const timeOffIdSchema = uuidString;
