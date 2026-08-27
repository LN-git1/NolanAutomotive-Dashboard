import { desc, eq } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { csvResponse, toCsv } from '@/lib/csv';
import { db } from '@/lib/db';
import { supplierLedger, suppliers } from '@/lib/db/schema';
import { todayIsoDate } from '@/lib/format';

export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  const rows = await db
    .select({
      supplier: suppliers.name,
      entryDate: supplierLedger.entryDate,
      kind: supplierLedger.kind,
      reference: supplierLedger.reference,
      amount: supplierLedger.amount,
      notes: supplierLedger.notes,
      createdAt: supplierLedger.createdAt,
    })
    .from(supplierLedger)
    .innerJoin(suppliers, eq(supplierLedger.supplierId, suppliers.id))
    // Same tiebreak as the on-screen history: `bill_date` is a bare DATE, so
    // a purchase and the payment settling it on one afternoon would otherwise
    // export in an arbitrary order.
    .orderBy(desc(supplierLedger.entryDate), desc(supplierLedger.createdAt));

  /*
    Two signed columns rather than one amount and a type flag: a spreadsheet
    can then sum the account without the reader first having to work out which
    rows to subtract, and the CSV says the same thing the account page does.
  */
  const csv = toCsv(
    rows.map((row) => ({
      ...row,
      type: row.kind === 'payment' ? 'Paid off' : 'Added to bill',
      added: row.kind === 'payment' ? '' : row.amount,
      paidOff: row.kind === 'payment' ? row.amount : '',
    })),
    [
      { key: 'supplier', header: 'Supplier' },
      { key: 'entryDate', header: 'Date' },
      { key: 'type', header: 'Type' },
      { key: 'reference', header: 'Reference' },
      { key: 'added', header: 'Added to bill' },
      { key: 'paidOff', header: 'Paid off' },
      { key: 'notes', header: 'Notes' },
      { key: 'createdAt', header: 'Recorded' },
    ],
  );

  return csvResponse(csv, `nolan-supplier-bills-${todayIsoDate()}.csv`);
}
