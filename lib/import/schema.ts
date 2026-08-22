import { z } from 'zod';

export type ImportKind = 'screenshot' | 'markdown' | 'voice';

const extractedLabourLineSchema = z.object({
  description: z.string().trim().max(300).optional(),
  hours: z.union([z.string(), z.number()]).optional(),
});

const extractedPartLineSchema = z.object({
  partName: z.string().trim().max(200).optional(),
  partNumber: z.string().trim().max(60).optional(),
  qty: z.union([z.string(), z.number()]).optional(),
  unitPrice: z.union([z.string(), z.number()]).optional(),
});

/**
 * What the model is asked to return, validated leniently — a photo or a
 * ten-second voice note routinely won't supply everything, so every field is
 * optional here. The form's own `jobInputSchema` still enforces what's
 * actually required (customerName, vehicleRegistration) at real submit time,
 * unchanged.
 *
 * Deliberately excludes `status`, `hourlyRate`, and `labourTotalOverride` —
 * see the Global Constraints note in the plan this schema was built from.
 * Do not add them here without also adding an explicit guard wherever the
 * resulting prefill could reach `createJob`.
 */
export const extractedJobSchema = z.object({
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  customerEmail: z.string().trim().max(200).optional(),
  customerAddress: z.string().trim().max(500).optional(),

  vehicleRegistration: z.string().trim().max(32).optional(),
  vehicleMake: z.string().trim().max(100).optional(),
  vehicleModel: z.string().trim().max(100).optional(),
  vehicleVin: z.string().trim().max(50).optional(),
  vehicleColor: z.string().trim().max(50).optional(),
  vehicleYear: z.union([z.string(), z.number()]).optional(),
  vehicleMileage: z.union([z.string(), z.number()]).optional(),

  dueDate: z.string().trim().optional(),
  dueTime: z.string().trim().optional(),
  priority: z.string().trim().optional(),

  labourLines: z.array(extractedLabourLineSchema).max(50).default([]),
  parts: z.array(extractedPartLineSchema).max(50).default([]),

  otherComments: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type ExtractedJob = z.infer<typeof extractedJobSchema>;
