import type { Metadata } from 'next';
import Link from 'next/link';

import { SupplierForm } from '@/components/suppliers/supplier-form';
import { Card, CardBody, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { listSuppliersWithTotals } from '@/lib/db/queries/overview';
import { formatEur } from '@/lib/money';

export const metadata: Metadata = { title: 'Owed to others' };
export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const suppliers = await listSuppliersWithTotals();
  const totalOwed = suppliers.reduce((sum, supplier) => sum + Number(supplier.outstandingCents), 0);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Owed to others</h1>
        <p className="text-sm text-muted">Suppliers and outstanding bills.</p>
      </div>

      <Card>
        <CardBody>
          <p className="text-xs font-medium text-muted">Total owed to suppliers</p>
          <p className="mt-1 text-2xl font-semibold text-ink tabular">{formatEur(totalOwed)}</p>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_22rem]">
        <Card>
          <CardHeader title="Suppliers" />
          {suppliers.length === 0 ? (
            <Empty>No suppliers yet. Add one to start tracking bills.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Bills</Th>
                  <Th className="text-right">Outstanding</Th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <Td>
                      <Link
                        href={`/suppliers/${supplier.id}`}
                        className="font-medium text-brand-dark hover:underline"
                      >
                        {supplier.name}
                      </Link>
                      {supplier.notes ? (
                        <div className="text-xs text-muted">{supplier.notes}</div>
                      ) : null}
                    </Td>
                    <Td className="text-muted">{supplier.billCount}</Td>
                    <Td className="text-right tabular">
                      {formatEur(Number(supplier.outstandingCents))}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Add supplier" />
          <SupplierForm />
        </Card>
      </div>
    </div>
  );
}
