import 'server-only';

import { getJob } from '@/lib/db/queries/jobs';
import { getSettings } from '@/lib/db/queries/settings';
import { calcInvoiceTotals } from '@/lib/money';
import { partsRowCapacity, type StampInvoiceInput, type StampPartLine } from '@/lib/pdf/stamp';
import type { InvoiceDraft } from '@/lib/validation/invoice';
import type { Job, Settings } from '@/lib/db/schema';

/**
 * Turns an Invoicer form payload into everything needed to stamp a PDF and, if
 * the owner sends it, to persist an invoice row.
 *
 * Both `/api/invoices/generate` (preview) and `/api/invoices/finalize` (commit)
 * call this with the same draft. Sharing one builder is what guarantees the
 * previewed document and the stored document are byte-identical apart from the
 * invoice number.
 */

export class InvoiceBuildError extends Error {}

export interface BuiltInvoice {
  job: Job;
  settings: Settings;
  totals: ReturnType<typeof calcInvoiceTotals>;
  stampInput: StampInvoiceInput;
  parts: StampPartLine[];
}

export async function buildInvoice(
  draft: InvoiceDraft,
  options: { invoiceNumber: string; issueDate: Date },
): Promise<BuiltInvoice> {
  const [job, settings] = await Promise.all([getJob(draft.jobId), getSettings()]);

  if (!job) {
    throw new InvoiceBuildError('That job no longer exists.');
  }

  if (job.status === 'paid') {
    throw new InvoiceBuildError('This job is already marked paid and cannot be invoiced again.');
  }

  const capacity = partsRowCapacity();
  if (draft.parts.length > capacity) {
    throw new InvoiceBuildError(
      `The invoice template has room for ${capacity} part lines but ${draft.parts.length} were entered. ` +
        `Consolidate the lines or issue a second invoice.`,
    );
  }

  // VAT is driven entirely by Settings. When the business is not registered the
  // rate and every tax amount are forced to zero.
  const vatEnabled = settings.vatRegistered;

  const totals = calcInvoiceTotals({
    labourHours: draft.labourHours,
    hourlyRate: draft.hourlyRate,
    parts: draft.parts,
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

    workCarriedOut: draft.workCarriedOut,
    otherComments: draft.otherComments,
    vatNumber: vatEnabled ? settings.vatNumber : null,

    parts,

    servicesSubtotalCents: totals.servicesSubtotalCents,
    partsSubtotalCents: totals.partsSubtotalCents,
    totalTaxCents: totals.totalTaxCents,
    grandTotalCents: totals.grandTotalCents,
    vatBasisPoints: totals.vatBasisPoints,
    vatEnabled,
  };

  return { job, settings, totals, stampInput, parts };
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
