import 'server-only';

import { getJob } from '@/lib/db/queries/jobs';
import { getSettings } from '@/lib/db/queries/settings';
import { calcInvoiceTotals, fromCents } from '@/lib/money';
import {
  labourRowCapacity,
  partsRowCapacity,
  type StampInvoiceInput,
  type StampLabourLine,
  type StampPartLine,
} from '@/lib/pdf/stamp';
import type { Job, Settings } from '@/lib/db/schema';

export { buildInvoiceFileName } from './fileName';

/**
 * Turns a job into everything needed to stamp a PDF and, the first time, to
 * persist an invoice row.
 *
 * `/api/invoices/generate` calls this whether it is issuing a new invoice or
 * regenerating the live one for a job that already has one — both paths share
 * this one builder, which is what guarantees a regenerated document always
 * matches the job's current content exactly.
 */

export class InvoiceBuildError extends Error {}

export interface BuiltInvoice {
  job: Job;
  settings: Settings;
  totals: ReturnType<typeof calcInvoiceTotals>;
  stampInput: StampInvoiceInput;
  parts: StampPartLine[];
  labourLines: StampLabourLine[];
  /** True when the job is already paid — the UI warns before letting an edit through. */
  alreadyPaid: boolean;
}

export async function buildInvoice(
  jobId: string,
  options: { invoiceNumber: string; issueDate: Date },
): Promise<BuiltInvoice> {
  const [job, settings] = await Promise.all([getJob(jobId), getSettings()]);

  if (!job) {
    throw new InvoiceBuildError('That job no longer exists.');
  }

  const labourLines: StampLabourLine[] = (job.labourLines ?? []).filter(
    (line) => line.description.trim() !== '' || line.hours.trim() !== '',
  );
  const jobParts = job.parts ?? [];

  const labourCapacity = labourRowCapacity();
  if (labourLines.length > labourCapacity) {
    throw new InvoiceBuildError(
      `The invoice template has room for ${labourCapacity} work lines but ${labourLines.length} ` +
        `were entered. Consolidate the lines on the job.`,
    );
  }

  const partsCapacity = partsRowCapacity();
  if (jobParts.length > partsCapacity) {
    throw new InvoiceBuildError(
      `The invoice template has room for ${partsCapacity} part lines but ${jobParts.length} ` +
        `were entered. Consolidate the lines on the job.`,
    );
  }

  // VAT is driven entirely by Settings. When the business is not registered the
  // rate and every tax amount are forced to zero.
  const vatEnabled = settings.vatRegistered;

  const totals = calcInvoiceTotals({
    labourLines,
    hourlyRate: job.hourlyRate,
    labourTotalOverride: job.labourTotalOverride,
    parts: jobParts,
    vatRate: settings.defaultVatRate,
    vatEnabled,
  });

  const parts: StampPartLine[] = totals.parts.map((part) => ({
    partName: part.partName,
    partNumber: part.partNumber,
    qty: String(part.qty),
    unitPrice: String(part.unitPrice),
    amount: part.amount,
  }));

  const stampInput: StampInvoiceInput = {
    invoiceNumber: options.invoiceNumber,
    issueDate: options.issueDate,

    customerName: job.customerName,
    customerAddress: job.customerAddress,
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,

    vehicleRegistration: job.vehicleRegistration,
    vehicleYear: job.vehicleYear,
    vehicleMake: job.vehicleMake,
    vehicleModel: job.vehicleModel,
    vehicleColor: job.vehicleColor,
    vehicleMileage: job.vehicleMileage,
    vehicleVin: job.vehicleVin,

    labourLines,
    otherComments: job.otherComments,
    vatNumber: vatEnabled ? settings.vatNumber : null,

    parts,

    labourSubtotalCents: totals.labourSubtotalCents,
    partsSubtotalCents: totals.partsSubtotalCents,
    totalTaxCents: totals.totalTaxCents,
    grandTotalCents: totals.grandTotalCents,
    vatBasisPoints: totals.vatBasisPoints,
    vatEnabled,
  };

  return {
    job,
    settings,
    totals,
    stampInput,
    parts,
    labourLines,
    alreadyPaid: job.status === 'paid',
  };
}

/**
 * The invoice row's own copy of the priced content.
 *
 * The job stays editable, so the invoice must not derive its totals from the job
 * at read time — money owed, the Overview and the CSV exports all have to keep
 * reporting what was actually sent. Finalising and regenerating both write this,
 * which is what keeps the stored document and the stored numbers in step.
 */
export function invoiceSnapshot(built: BuiltInvoice) {
  const { totals, settings } = built;

  return {
    labourLines: built.labourLines,
    labourTotalOverride: built.job.labourTotalOverride,
    hourlyRate: built.job.hourlyRate,
    labourSubtotal: fromCents(totals.labourSubtotalCents),
    partsSubtotal: fromCents(totals.partsSubtotalCents),
    vatRate: settings.vatRegistered ? settings.defaultVatRate : '0.00',
    vatAmount: fromCents(totals.totalTaxCents),
    totalLabour: fromCents(totals.labourSubtotalCents),
    totalParts: fromCents(totals.partsSubtotalCents),
    grandTotal: fromCents(totals.grandTotalCents),
    parts: built.parts,
    otherComments: built.job.otherComments,
  };
}

/** Standard PDF response headers for an inline preview or download. */
export function pdfResponse(bytes: Uint8Array, fileName: string, extraHeaders?: HeadersInit) {
  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'no-store',
      ...Object.fromEntries(new Headers(extraHeaders).entries()),
    },
  });
}
