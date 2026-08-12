import { desc, eq } from 'drizzle-orm';

import { requireApiSession } from '@/lib/auth/require-session';
import { csvResponse, toCsv } from '@/lib/csv';
import { db } from '@/lib/db';
import { supplierBills, suppliers } from '@/lib/db/schema';
import { todayIsoDate } from '@/lib/format';

export const runtime = 'nodejs';

export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  const rows = await db
    .select({
      supplier: suppliers.name,
      billDate: supplierBills.billDate,
      reference: supplierBills.reference,
      amount: supplierBills.amount,
      notes: supplierBills.notes,
      paidAt: supplierBills.paidAt,
      createdAt: supplierBills.createdAt,
    })
    .from(supplierBills)
    .innerJoin(suppliers, eq(supplierBills.supplierId, suppliers.id))
    .orderBy(desc(supplierBills.billDate));

  const csv = toCsv(
    rows.map((row) => ({ ...row, status: row.paidAt ? 'paid' : 'outstanding' })),
    [
      { key: 'supplier', header: 'Supplier' },
      { key: 'billDate', header: 'Bill date' },
      { key: 'reference', header: 'Reference' },
      { key: 'amount', header: 'Amount' },
      { key: 'status', header: 'Status' },
      { key: 'paidAt', header: 'Paid at' },
      { key: 'notes', header: 'Notes' },
      { key: 'createdAt', header: 'Recorded' },
    ],
  );

  return csvResponse(csv, `nolan-supplier-bills-${todayIsoDate()}.csv`);
}
