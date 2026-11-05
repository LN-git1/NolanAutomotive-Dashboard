import { z } from 'zod';

import { requiredText, uuidString } from './common';

export const assigneeInputSchema = z.object({
  name: requiredText('Name', 60),
});

export const assigneeIdSchema = uuidString;

/**
 * The ids picked on the job form. A dropdown left on "Unassigned" posts an empty
 * string, which means "nobody" rather than a bad id, so blanks are dropped first.
 * Duplicates are collapsed.
 */
export const jobAssigneeIdsSchema = z.preprocess(
  (value) => (Array.isArray(value) ? value.filter((id) => id !== '') : value),
  z
    .array(uuidString)
    .max(50, 'Too many people on one job')
    .transform((ids) => [...new Set(ids)]),
);
