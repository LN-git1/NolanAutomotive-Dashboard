import { desc, eq } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { csvResponse, toCsv } from '@/lib/csv';
import { db } from '@/lib/db';
import { invoices, jobs } from '@/lib/db/schema';
import { todayIsoDate } from '@/lib/format';

export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  const rows = await db
    .select({
      invoiceNumber: invoices.invoiceNumber,
      issueDate: invoices.issueDate,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      vehicleRegistration: jobs.vehicleRegistration,
      jobStatus: jobs.status,
      hourlyRate: invoices.hourlyRate,
      totalLabour: invoices.totalLabour,
      totalParts: invoices.totalParts,
      vatRate: invoices.vatRate,
      vatAmount: invoices.vatAmount,
      grandTotal: invoices.grandTotal,
      sentVia: invoices.sentVia,
      sentAt: invoices.sentAt,
      voidedAt: invoices.voidedAt,
    })
    .from(invoices)
    .innerJoin(jobs, eq(invoices.jobId, jobs.id))
    // Issued order. sentAt is nullable and would sort NULLS FIRST on DESC.
    .orderBy(desc(invoices.createdAt));

  const csv = toCsv(rows, [
    { key: 'invoiceNumber', header: 'Invoice number' },
    { key: 'issueDate', header: 'Issue date' },
    { key: 'jobNumber', header: 'Job number' },
    { key: 'customerName', header: 'Customer' },
    { key: 'vehicleRegistration', header: 'Registration' },
    { key: 'jobStatus', header: 'Job status' },
    { key: 'hourlyRate', header: 'Hourly rate' },
    { key: 'totalLabour', header: 'Total labour' },
    { key: 'totalParts', header: 'Total parts' },
    { key: 'vatRate', header: 'VAT rate %' },
    { key: 'vatAmount', header: 'VAT amount' },
    { key: 'grandTotal', header: 'Grand total' },
    { key: 'sentVia', header: 'Sent via' },
    { key: 'sentAt', header: 'Sent at' },
    // Blank for a live invoice. A voided one keeps its row and its number so the
    // sequence stays continuous — the accountant needs to see it, marked.
    { key: 'voidedAt', header: 'Voided at' },
  ]);

  return csvResponse(csv, `nolan-invoices-${todayIsoDate()}.csv`);
}
