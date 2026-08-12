import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { BillActions } from '@/components/suppliers/bill-actions';
import { BillForm } from '@/components/suppliers/bill-form';
import { Badge, Card, CardBody, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { getSupplierWithBills } from '@/lib/db/queries/overview';
import { formatDate, numericToEur } from '@/lib/format';
import { formatEur, toCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Supplier' };
export const dynamic = 'force-dynamic';

export default async function SupplierDetailPage({
  params,
}: PageProps<'/suppliers/[supplierId]'>) {
  const { supplierId } = await params;
  const supplier = await getSupplierWithBills(supplierId);

  if (!supplier) notFound();

  const outstandingCents = supplier.bills
    .filter((bill) => bill.paidAt === null)
    .reduce((sum, bill) => sum + toCents(bill.amount), 0);

  const totalCents = supplier.bills.reduce((sum, bill) => sum + toCents(bill.amount), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">{supplier.name}</h1>
        {supplier.notes ? <p className="text-sm text-muted">{supplier.notes}</p> : null}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-muted">Outstanding</p>
            <p className="mt-1 text-2xl font-semibold text-ink tabular">
              {formatEur(outstandingCents)}
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardBody>
            <p className="text-xs font-medium text-muted">All bills recorded</p>
            <p className="mt-1 text-2xl font-semibold text-ink tabular">{formatEur(totalCents)}</p>
          </CardBody>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader title="Bills" />
          {supplier.bills.length === 0 ? (
            <Empty>No bills recorded for this supplier.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Date</Th>
                  <Th>Reference</Th>
                  <Th className="text-right">Amount</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {supplier.bills.map((bill) => (
                  <tr key={bill.id}>
                    <Td className="text-muted">{formatDate(bill.billDate)}</Td>
                    <Td>
                      <div>{bill.reference ?? '—'}</div>
                      {bill.notes ? <div className="text-xs text-muted">{bill.notes}</div> : null}
                    </Td>
                    <Td className="text-right tabular">{numericToEur(bill.amount)}</Td>
                    <Td>
                      <Badge value={bill.paidAt ? 'paid' : 'invoiced'} />
                    </Td>
                    <Td>
                      <BillActions
                        billId={bill.id}
                        paid={bill.paidAt !== null}
                        reference={bill.reference ?? formatDate(bill.billDate)}
                      />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Add bill" />
          <BillForm supplierId={supplier.id} />
        </Card>
      </div>
    </div>
  );
}
