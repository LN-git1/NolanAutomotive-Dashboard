import { z } from 'zod';

import { requiredText, uuidString } from './common';

export const assigneeInputSchema = z.object({
  name: requiredText('Name', 60),
});

export const assigneeIdSchema = uuidString;

/** The ids ticked on the job form. Duplicates are collapsed. */
export const jobAssigneeIdsSchema = z
  .array(uuidString)
  .max(50, 'Too many people on one job')
  .transform((ids) => [...new Set(ids)]);
