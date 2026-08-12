import { z } from 'zod';

import {
  optionalDate,
  optionalEmail,
  optionalInt,
  optionalText,
  requiredText,
  uuidString,
} from './common';

export const JOB_STATUSES = ['new', 'active', 'completed', 'invoiced', 'paid'] as const;
export const JOB_PRIORITIES = ['low', 'medium', 'high'] as const;

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const jobPrioritySchema = z.enum(JOB_PRIORITIES);

const currentYear = new Date().getFullYear();

export const jobInputSchema = z.object({
  customerName: requiredText('Customer name', 200),
  customerPhone: optionalText,
  customerEmail: optionalEmail,
  customerAddress: optionalText,

  vehicleRegistration: requiredText('Vehicle registration', 32).transform((value) =>
    value.toUpperCase(),
  ),
  vehicleMake: optionalText,
  vehicleModel: optionalText,
  vehicleVin: optionalText,
  vehicleYear: optionalInt({ label: 'Year', min: 1900, max: currentYear + 2 }),
  vehicleMileage: optionalInt({ label: 'Mileage', min: 0, max: 5_000_000 }),
  vehicleColor: optionalText,

  status: jobStatusSchema.default('new'),
  priority: jobPrioritySchema.default('medium'),
  dueDate: optionalDate,
  notes: optionalText,
  internalNotes: optionalText,
});

export type JobInput = z.infer<typeof jobInputSchema>;

export const jobStatusChangeSchema = z.object({
  jobId: uuidString,
  status: jobStatusSchema,
});

export const jobIdSchema = z.object({ jobId: uuidString });

/** Query params for the jobs list page. */
export const jobFilterSchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.union([jobStatusSchema, z.literal('all')]).optional(),
});
