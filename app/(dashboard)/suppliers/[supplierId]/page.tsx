import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EntryActions } from '@/components/suppliers/entry-actions';
import { SupplierAccountActions } from '@/components/suppliers/supplier-account-actions';
import { SupplierActions } from '@/components/suppliers/supplier-actions';
import { Card, CardBody, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { getSupplierWithEntries } from '@/lib/db/queries/overview';
import { formatDate, numericToEur } from '@/lib/format';
import { formatEur, toCents } from '@/lib/money';

export const metadata: Metadata = { title: 'Supplier' };
export const dynamic = 'force-dynamic';

export default async function SupplierDetailPage({
  params,
}: PageProps<'/suppliers/[supplierId]'>) {
  const { supplierId } = await params;
  const supplier = await getSupplierWithEntries(supplierId);

  if (!supplier) notFound();

  /*
    The account is one running total, so the three figures below come from one
    pass over the same entries — charges on, payments off. Cents throughout
    (`toCents`), never float euro, matching every other money total in the app.
  */
  const chargedCents = supplier.entries
    .filter((entry) => entry.kind === 'charge')
    .reduce((sum, entry) => sum + toCents(entry.amount), 0);

  const paidCents = supplier.entries
    .filter((entry) => entry.kind === 'payment')
    .reduce((sum, entry) => sum + toCents(entry.amount), 0);

  const balanceCents = chargedCents - paidCents;

  /*
    Entries arrive newest-first, which is how the table reads, but a running
    balance only makes sense computed oldest-first. So it is worked out in
    chronological order and looked up by id on the way back down the list —
    every row then answers "what was on the bill after this?".
  */
  const balanceAfter = new Map<string, number>();
  let running = 0;
  for (const entry of [...supplier.entries].reverse()) {
    running += entry.kind === 'payment' ? -toCents(entry.amount) : toCents(entry.amount);
    balanceAfter.set(entry.id, running);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">{supplier.name}</h1>
          {supplier.notes ? <p className="text-sm text-muted">{supplier.notes}</p> : null}
        </div>
        <SupplierActions supplierId={supplier.id} name={supplier.name} redirectOnDelete />
      </div>

      <Card>
        <CardBody className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-medium text-muted">
              {balanceCents < 0 ? 'In credit' : 'On the bill'}
            </p>
            <p className="mt-1 text-3xl font-semibold text-ink tabular">
              {formatEur(Math.abs(balanceCents))}
            </p>
            <p className="mt-1 text-xs text-muted tabular">
              {formatEur(chargedCents)} added · {formatEur(paidCents)} paid off
            </p>
          </div>

          <SupplierAccountActions
            supplierId={supplier.id}
            supplierName={supplier.name}
            balanceCents={balanceCents}
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="History" />
        {supplier.entries.length === 0 ? (
          <Empty>
            Nothing on this account yet. Add a purchase to start the bill.
          </Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Date</Th>
                <Th>Details</Th>
                <Th className="text-right">Added</Th>
                <Th className="text-right">Paid off</Th>
                <Th className="text-right">Balance</Th>
                <Th className="text-right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {supplier.entries.map((entry) => {
                const isPayment = entry.kind === 'payment';
                const label = `${isPayment ? 'payment' : 'purchase'} of ${numericToEur(
                  entry.amount,
                )} on ${formatDate(entry.entryDate)}`;

                return (
                  <tr key={entry.id}>
                    <Td label="Date" className="text-muted">
                      {formatDate(entry.entryDate)}
                    </Td>
                    <Td label="Details">
                      <div>{entry.reference ?? (isPayment ? 'Payment' : 'Purchase')}</div>
                      {entry.notes ? (
                        <div className="text-xs text-muted">{entry.notes}</div>
                      ) : null}
                      {entry.attachmentStoragePath ? (
                        <a
                          href={`/api/supplier-bills/${entry.id}/receipt`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-brand-dark hover:underline"
                        >
                          View receipt
                        </a>
                      ) : null}
                    </Td>
                    <Td label="Added" className="text-right tabular">
                      {isPayment ? '—' : numericToEur(entry.amount)}
                    </Td>
                    <Td label="Paid off" className="text-right tabular text-brand-dark">
                      {isPayment ? numericToEur(entry.amount) : '—'}
                    </Td>
                    <Td label="Balance" className="text-right tabular text-muted">
                      {formatEur(balanceAfter.get(entry.id) ?? 0)}
                    </Td>
                    <Td label="Actions">
                      <EntryActions entryId={entry.id} label={label} />
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
