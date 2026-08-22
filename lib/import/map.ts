import 'server-only';

import { normaliseMake, normaliseModel } from '@/lib/vehicles';
import { JOB_PRIORITIES } from '@/lib/validation/job';
import type { ExtractedJob } from './schema';

export interface ImportLabourLine {
  description: string;
  hours: string;
}

export interface ImportPartLine {
  partName: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
}

/** Form-ready prefill data — every field optional/absent rather than null, matching `JobForm`'s existing `Prefill` shape. */
export interface ImportPrefill {
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  vehicleRegistration?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  vehicleColor?: string;
  vehicleYear?: number;
  vehicleMileage?: number;
  dueDate?: string;
  dueTime?: string;
  priority?: string;
  labourLines: ImportLabourLine[];
  parts: ImportPartLine[];
  otherComments?: string;
  notes?: string;
}

const CURRENT_YEAR = new Date().getFullYear();

/** "2.5 hours" / 2.5 / "€45.00" / "1x" -> a plain decimal string, or undefined if nothing numeric is present. */
function toDecimalString(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = String(value);
  const match = raw.match(/\d+(\.\d+)?/);
  if (!match) return undefined;
  return match[0];
}

function toOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '' ? trimmed : undefined;
}

function toValidYear(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return undefined;
  if (n < 1900 || n > CURRENT_YEAR + 2) return undefined;
  return n;
}

function toValidMileage(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > 5_000_000) return undefined;
  return n;
}

function toValidDate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

function toValidTime(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) return undefined;
  return trimmed;
}

function toValidPriority(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && (JOB_PRIORITIES as readonly string[]).includes(trimmed) ? trimmed : undefined;
}

/**
 * Normalizes a raw LLM extraction into what `JobForm` actually consumes.
 * Rows with no meaningful content are dropped rather than kept as blank
 * lines the owner would have to notice and remove by hand. Anything that
 * doesn't validate (a bad date, an out-of-range year, an unknown priority)
 * is dropped, not passed through wrong — silence is safer than a confidently
 * wrong value on a real customer's job.
 */
export function mapExtractedToPrefill(extracted: ExtractedJob): ImportPrefill {
  const labourLines: ImportLabourLine[] = (extracted.labourLines ?? [])
    .map((line) => ({
      description: toOptionalString(line.description) ?? '',
      hours: toDecimalString(line.hours) ?? '',
    }))
    .filter((line) => line.description !== '')
    .slice(0, 50);

  const parts: ImportPartLine[] = (extracted.parts ?? [])
    .map((part) => ({
      partName: toOptionalString(part.partName) ?? '',
      partNumber: toOptionalString(part.partNumber) ?? '',
      qty: toDecimalString(part.qty) ?? '',
      unitPrice: toDecimalString(part.unitPrice) ?? '',
    }))
    .filter((part) => part.partName !== '')
    .slice(0, 50);

  const make = normaliseMake(extracted.vehicleMake);

  return {
    customerName: toOptionalString(extracted.customerName),
    customerPhone: toOptionalString(extracted.customerPhone),
    customerEmail: toOptionalString(extracted.customerEmail),
    customerAddress: toOptionalString(extracted.customerAddress),
    vehicleRegistration: toOptionalString(extracted.vehicleRegistration)?.toUpperCase(),
    vehicleMake: make,
    vehicleModel: normaliseModel(make, extracted.vehicleModel),
    vehicleVin: toOptionalString(extracted.vehicleVin),
    vehicleColor: toOptionalString(extracted.vehicleColor),
    vehicleYear: toValidYear(extracted.vehicleYear),
    vehicleMileage: toValidMileage(extracted.vehicleMileage),
    dueDate: toValidDate(extracted.dueDate),
    dueTime: toValidTime(extracted.dueTime),
    priority: toValidPriority(extracted.priority),
    labourLines,
    parts,
    otherComments: toOptionalString(extracted.otherComments),
    notes: toOptionalString(extracted.notes),
  };
}

/** True only when every field and both arrays are empty — the "found nothing usable" case. */
export function isPrefillEmpty(prefill: ImportPrefill): boolean {
  const { labourLines, parts, ...scalars } = prefill;
  const hasScalar = Object.values(scalars).some((value) => value !== undefined);
  return !hasScalar && labourLines.length === 0 && parts.length === 0;
}
