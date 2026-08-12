import type { Metadata } from 'next';
import Link from 'next/link';

import { MarkPaidButton } from '@/components/payments/mark-paid-button';
import { Card, CardBody, Empty, Table, Td, Th } from '@/components/ui';
import { listAwaitingPayment } from '@/lib/db/queries/jobs';
import { formatDate, numericToEur } from '@/lib/format';
import { toCents } from '@/lib/money';
import { formatEur } from '@/lib/money';

export const metadata: Metadata = { title: 'Awaiting payments' };
export const dynamic = 'force-dynamic';

export default async function AwaitingPaymentsPage() {
  const rows = await listAwaitingPayment();

  const totalCents = rows.reduce(
    (sum, row) => sum + (row.invoice ? toCents(row.invoice.grandTotal) : 0),
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Awaiting payments</h1>
        <p className="text-sm text-muted">Jobs that have been invoiced but not yet paid.</p>
      </div>

      <Card>
        <CardBody>
          <p className="text-xs font-medium text-muted">Total outstanding</p>
          <p className="mt-1 text-2xl font-semibold text-ink tabular">{formatEur(totalCents)}</p>
        </CardBody>
      </Card>

      <Card>
        {rows.length === 0 ? (
          <Empty>Nothing outstanding. Every invoiced job has been paid.</Empty>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Job</Th>
                <Th>Customer</Th>
                <Th>Invoice</Th>
                <Th>Issued</Th>
                <Th className="text-right">Total</Th>
                <Th className="text-right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ job, invoice }) => (
                <tr key={job.id}>
                  <Td>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="font-medium text-brand-dark hover:underline"
                    >
                      {job.jobNumber}
                    </Link>
                    <div className="text-xs text-muted">{job.vehicleRegistration}</div>
                  </Td>
                  <Td>{job.customerName}</Td>
                  <Td>
                    {invoice ? (
                      <Link
                        href={`/api/invoices/${invoice.id}/pdf`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-brand-dark hover:underline"
                      >
                        {invoice.invoiceNumber}
                      </Link>
                    ) : (
                      <span className="text-muted">—</span>
                    )}
                  </Td>
                  <Td className="text-muted">{formatDate(invoice?.issueDate)}</Td>
                  <Td className="text-right tabular">
                    {invoice ? numericToEur(invoice.grandTotal) : '—'}
                  </Td>
                  <Td className="text-right">
                    <MarkPaidButton jobId={job.id} jobNumber={job.jobNumber} />
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
