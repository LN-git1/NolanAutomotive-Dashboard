import { z } from 'zod';

import {
  jsonArray,
  optionalDate,
  optionalDecimal,
  optionalDecimalString,
  optionalEmail,
  optionalInt,
  optionalText,
  optionalTime,
  requiredText,
  uuidString,
} from './common';

/**
 * `new` was deliberately removed — a job that exists is a job that is active,
 * so the extra state cost a tap and earned nothing.
 */
export const JOB_STATUSES = ['active', 'completed', 'invoiced', 'paid'] as const;
export const JOB_PRIORITIES = ['low', 'medium', 'high'] as const;

/**
 * What the owner is shown, as distinct from what the column stores.
 *
 * `completed` earns a label because the bare word was actively misleading: it
 * means "the work on the car is finished", but it was read as "this job is
 * finished and paid for" — which is what `paid` means. Two green badges saying
 * near-synonyms is how the Overview came to show "Completed jobs: 2" beside
 * "Paid: 0" and have both look wrong. "Work done" cannot be confused with money.
 *
 * The enum values themselves are untouched: they are what the CSV export
 * writes, and that column is machine-readable.
 */
export const JOB_STATUS_LABELS: Record<(typeof JOB_STATUSES)[number], string> = {
  active: 'Active',
  completed: 'Work done',
  invoiced: 'Invoiced',
  paid: 'Paid',
};

export const JOB_PRIORITY_LABELS: Record<(typeof JOB_PRIORITIES)[number], string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

export const jobStatusSchema = z.enum(JOB_STATUSES);
export const jobPrioritySchema = z.enum(JOB_PRIORITIES);

const currentYear = new Date().getFullYear();

/**
 * One row of the invoice's WORK CARRIED OUT table: what was done, and the hours
 * it took. Hours may be blank for a line that carries no billable time (e.g.
 * "Road tested"), which prints an empty HOUR(S) cell.
 */
export const labourLineSchema = z.object({
  description: z.string().trim().max(300).default(''),
  hours: optionalDecimalString({ label: 'Hours' }),
});

export type LabourLineInput = z.infer<typeof labourLineSchema>;

/**
 * A blank quantity or price is read as zero rather than rejected: the owner is
 * mid-entry as often as mistaken, and a line worth nothing is a legitimate thing
 * to record. A *malformed* number is still an error.
 */
export const partLineSchema = z.object({
  partName: z.string().trim().min(1, 'Part name is required').max(200),
  partNumber: z.string().trim().max(60).default(''),
  qty: optionalDecimalString({ label: 'Quantity' }).transform((value) =>
    value === '' ? '0' : value,
  ),
  unitPrice: optionalDecimalString({ label: 'Unit price' }).transform((value) =>
    value === '' ? '0' : value,
  ),
});

export type PartLineInput = z.infer<typeof partLineSchema>;

/**
 * The job now carries everything that ends up on the invoice. This is the point
 * of the job-centred rework: one record, entered once, editable forever, and
 * re-read every time an invoice is generated or regenerated.
 */
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

  status: jobStatusSchema.default('active'),
  priority: jobPrioritySchema.default('medium'),
  dueDate: optionalDate,
  dueTime: optionalTime,

  // Invoice content.
  labourLines: jsonArray(labourLineSchema, { label: 'Work lines', max: 50 }),
  hourlyRate: optionalDecimal({ label: 'Hourly rate' }),
  /** When set, this is the labour total outright — hours x rate is ignored. */
  labourTotalOverride: optionalDecimal({ label: 'Custom labour total' }),
  parts: jsonArray(partLineSchema, { label: 'Parts', max: 50 }),
  /** When set, this is the parts total outright — the summed line amounts are ignored. */
  partsTotalOverride: optionalDecimal({ label: 'Custom parts total' }),
  otherComments: optionalText,

  /** Private. Never printed on an invoice. */
  notes: optionalText,
});

export type JobInput = z.infer<typeof jobInputSchema>;

/**
 * Neither creating nor editing a job's CONTENT can touch its status. Status is
 * owned by the things that actually move a job along — issuing an invoice,
 * recording a payment — plus the deliberate dropdown in `JobActions`, which
 * routes through `changeJobStatus` and its `paid` guard.
 *
 * `updateJob` used to parse with `jobInputSchema` and spread the result, so the
 * job form's own status `<select>` was written on every save. That select was
 * uncontrolled (`defaultValue`), so it still held the value the page was
 * rendered with: recording a payment flipped a job to `paid`, then the next
 * save silently put it back. J-0019 was settled in full and reverted to
 * `completed` exactly that way, which is what kept it in Awaiting Payments at
 * EUR 0.00 owed and off the Paid count.
 *
 * Omitting the key is the fix, not merely a tidy-up: `jobInputSchema.status`
 * defaults to `'active'`, so simply deleting the form field would have made
 * every save stamp `active` over whatever the job had reached.
 *
 * `createJob` uses this too, even though a brand-new job has no history to
 * protect: the job form's create path never renders a status control either,
 * so parsing with the full schema left a `status` key in a raw POST to the
 * Server Action reachable only by bypassing the browser UI — accepted and
 * inserted verbatim. Omitting it here means the column's own `default('active')`
 * decides, which is what a new job should be regardless.
 */
export const jobContentSchema = jobInputSchema.omit({ status: true });

export type JobContentInput = z.infer<typeof jobContentSchema>;

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
