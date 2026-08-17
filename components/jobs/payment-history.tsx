import { Card, CardHeader, Empty, Table, Td, Th } from '@/components/ui';
import { formatDate, numericToEur } from '@/lib/format';

export interface JobPaymentRow {
  id: string;
  amount: string;
  paidAt: Date;
}

/**
 * Read-only — date and amount only, nothing else. No editing: a mistaken
 * entry is corrected with an offsetting adjustment, not by rewriting history.
 * Plain Server Component, unlike `InvoiceCard` — there's no action here that
 * needs client state.
 */
export function PaymentHistory({ payments }: { payments: JobPaymentRow[] }) {
  const sorted = [...payments].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  return (
    <Card>
      <CardHeader title="Payments" />

      {sorted.length === 0 ? (
        <Empty>No payments recorded yet.</Empty>
      ) : (
        <Table className="min-w-0">
          <thead>
            <tr>
              <Th>Date</Th>
              <Th className="text-right">Amount</Th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((payment) => (
              <tr key={payment.id}>
                <Td label="Date" className="text-muted">
                  {formatDate(payment.paidAt)}
                </Td>
                <Td label="Amount" className="text-right tabular">
                  {numericToEur(payment.amount)}
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}
