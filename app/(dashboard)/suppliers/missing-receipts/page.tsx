import type { Metadata } from 'next';
import Link from 'next/link';

import { AddReceipt } from '@/components/suppliers/add-receipt';
import { Card, CardBody, CardHeader, Empty, LinkButton, Table, Td, Th } from '@/components/ui';
import { listChargesMissingReceipts } from '@/lib/db/queries/missing-receipts';
import { getSettings } from '@/lib/db/queries/settings';
import { formatDate, numericToEur } from '@/lib/format';
import { formatRecordedAt } from '@/lib/format-recorded';
import { formatEur, toCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Missing receipts' };
export const dynamic = 'force-dynamic';

export default async function MissingReceiptsPage() {
  const [rows, settings] = await Promise.all([listChargesMissingReceipts(), getSettings()]);

  // Cents, never float euro, like every other money total in the app.
  const totalCents = rows.reduce((sum, row) => sum + toCents(row.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">Missing receipts</h1>
          <p className="text-sm text-muted">
            Supplier purchases recorded without a receipt. Add the receipt here once you have it. The accountant can
            download this list to check against the paper receipts.
          </p>
        </div>
        <LinkButton
          href="/api/export/supplier-bills?missing=1"
          variant="secondary"
          size="sm"
          prefetch={false}
          download
        >
          Download list (CSV)
        </LinkButton>
      </div>

      <Card>
        <CardBody>
          <p className="text-xs font-medium text-muted">Purchases without a receipt</p>
          <p className="mt-1 text-2xl font-semibold text-ink tabular">{rows.length}</p>
          <p className="mt-1 text-xs text-muted tabular">Worth {formatEur(totalCents)} in total</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Purchases" description="Newest first. “Entered” is when it was typed into the app." />
        {rows.length === 0 ? (
          <Empty>Every purchase has a receipt on file.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Supplier</Th>
                <Th>Purchase date</Th>
                <Th>Entered</Th>
                <Th>Details</Th>
                <Th className="text-right">Amount</Th>
                <Th className="text-right">Receipt</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <Td label="Supplier">
                    <Link href={`/suppliers/${row.supplierId}`} className="font-medium text-brand-dark hover:underline">
                      {row.supplierName}
                    </Link>
                  </Td>
                  <Td label="Purchase date" className="text-muted">
                    {formatDate(row.entryDate)}
                  </Td>
                  <Td label="Entered" className="text-muted">
                    {formatRecordedAt(row.createdAt, settings.timeFormat)}
                  </Td>
                  <Td label="Details">
                    <div>{row.reference ?? 'Purchase'}</div>
                    {row.notes ? <div className="text-xs text-muted">{row.notes}</div> : null}
                  </Td>
                  <Td label="Amount" className="text-right tabular">
                    {numericToEur(row.amount)}
                  </Td>
                  <Td label="Receipt" className="text-right">
                    <AddReceipt entryId={row.id} supplierId={row.supplierId} />
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
