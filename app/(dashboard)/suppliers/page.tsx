import type { Metadata } from 'next';
import Link from 'next/link';

import { SupplierActions } from '@/components/suppliers/supplier-actions';
import { SupplierForm } from '@/components/suppliers/supplier-form';
import { Card, CardBody, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { listSuppliersWithTotals } from '@/lib/db/queries/overview';
import { formatDate } from '@/lib/format';
import { formatEur } from '@/lib/money';

export const metadata: Metadata = { title: 'Owed to others' };
export const dynamic = 'force-dynamic';

export default async function SuppliersPage() {
  const suppliers = await listSuppliersWithTotals();

  /*
    Each account is floored at zero before the accounts are added up, matching
    `getOwedToSuppliersCents` behind the Overview tile — one supplier holding a
    credit must not cancel out what is genuinely owed to another. The two
    figures are the same number on two screens and cannot be allowed to differ.
  */
  const totalOwed = suppliers.reduce(
    (sum, supplier) => sum + Math.max(Number(supplier.balanceCents), 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Owed to others</h1>
        <p className="text-sm text-muted">
          One running bill per supplier. Open one to add purchases or pay money off it.
        </p>
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
            <Empty>No suppliers yet. Add one to start a bill.</Empty>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Supplier</Th>
                  <Th>Last entry</Th>
                  <Th className="text-right">On the bill</Th>
                  <Th className="text-right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <Td label="Supplier">
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
                    <Td label="Last entry" className="text-muted">
                      {supplier.lastEntryDate ? formatDate(supplier.lastEntryDate) : '—'}
                    </Td>
                    <Td label="On the bill" className="text-right tabular">
                      {/* A credit is a real state here, so it is named rather
                          than shown as a bare minus sign the owner has to
                          decode. */}
                      {Number(supplier.balanceCents) < 0 ? (
                        <span className="text-muted">
                          {formatEur(Math.abs(Number(supplier.balanceCents)))} in credit
                        </span>
                      ) : (
                        formatEur(Number(supplier.balanceCents))
                      )}
                    </Td>
                    <Td label="Actions" className="text-right">
                      <div className="flex justify-end">
                        <SupplierActions supplierId={supplier.id} name={supplier.name} />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        {/* order-first: on a single-column phone this appears before the
            supplier list, so adding one doesn't need scrolling past it first.
            xl:order-none returns it to its natural (second) position once the
            two-column layout has room for both side by side. */}
        <Card className="order-first xl:order-none">
          <CardHeader title="Add supplier" />
          <SupplierForm />
        </Card>
      </div>
    </div>
  );
}
