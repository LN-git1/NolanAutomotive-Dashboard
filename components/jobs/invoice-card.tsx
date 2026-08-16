'use client';

import { Ban, FileText } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Alert, Button, Card, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { formatDate, numericToEur } from '@/lib/format';

export interface JobInvoiceRow {
  id: string;
  invoiceNumber: string;
  issueDate: string;
  grandTotal: string;
  voidedAt: string | null;
}

/**
 * The invoices issued for a job, with the two things that were previously
 * impossible: correcting one, and cancelling one.
 *
 * "Edit and re-send" is deliberately just a link to the job's own fields — the
 * job IS the invoice content now, so there is no separate invoice editor to
 * build or keep in step. The Invoicer does the regenerating.
 */
export function InvoiceCard({ invoices }: { invoices: JobInvoiceRow[] }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [voiding, setVoiding] = useState<string | null>(null);

  async function handleVoid(invoice: JobInvoiceRow) {
    const confirmed = window.confirm(
      `Void invoice ${invoice.invoiceNumber}?\n\n` +
        `It stops counting towards money owed and the job goes back to Completed so ` +
        `you can issue a new invoice. The number ${invoice.invoiceNumber} is never reused, ` +
        `and the record is kept.`,
    );
    if (!confirmed) return;

    setError(null);
    setVoiding(invoice.id);

    try {
      const response = await fetch(`/api/invoices/${invoice.id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not void the invoice.');
        return;
      }

      router.refresh();
    } catch {
      setError('Could not reach the server. The invoice was not voided.');
    } finally {
      setVoiding(null);
    }
  }

  const live = invoices.filter((invoice) => !invoice.voidedAt);

  return (
    <Card>
      <CardHeader title="Invoices" />

      {error ? (
        <div className="px-4 pt-3">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      {invoices.length === 0 ? (
        <Empty>No invoice issued for this job yet.</Empty>
      ) : (
        <>
          <Table className="min-w-0">
            <thead>
              <tr>
                <Th>Number</Th>
                <Th>Issued</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((invoice) => (
                <tr key={invoice.id}>
                  <Td>
                    <Link
                      href={`/api/invoices/${invoice.id}/pdf`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium text-brand-dark hover:underline"
                    >
                      {invoice.invoiceNumber}
                    </Link>
                    {invoice.voidedAt ? (
                      <span className="ml-2 rounded-full bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger">
                        VOID
                      </span>
                    ) : null}
                  </Td>
                  <Td className="text-muted">{formatDate(invoice.issueDate)}</Td>
                  <Td className="text-right tabular">
                    <span className={invoice.voidedAt ? 'text-muted line-through' : undefined}>
                      {numericToEur(invoice.grandTotal)}
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

          {live.length > 0 ? (
            <div className="flex flex-col gap-2 border-t border-line p-4">
              <p className="text-xs text-muted">
                Edit the job above, then re-send from the Invoicer — {live[0]?.invoiceNumber} keeps
                its number and the customer gets the corrected PDF.
              </p>
              <div className="flex flex-wrap gap-2">
                <Link
                  href="/invoicer"
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-canvas"
                >
                  <FileText aria-hidden className="size-4" />
                  Edit and re-send
                </Link>
                {live.map((invoice) => (
                  <Button
                    key={invoice.id}
                    type="button"
                    size="sm"
                    variant="danger"
                    disabled={voiding === invoice.id}
                    onClick={() => handleVoid(invoice)}
                  >
                    <Ban aria-hidden className="size-4" />
                    {voiding === invoice.id ? 'Voiding…' : `Void ${invoice.invoiceNumber}`}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}
        </>
      )}
    </Card>
  );
}
