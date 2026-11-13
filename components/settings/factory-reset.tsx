'use client';

import { AlertTriangle } from 'lucide-react';

import { Button, Card, CardBody, CardHeader } from '@/components/ui';
import { useToast } from '@/components/providers/toast-provider';

export interface ResetCounts {
  jobs: number;
  invoices: number;
  attachments: number;
  suppliers: number;
  supplierEntries: number;
  payments: number;
}

/**
 * The reset is switched off: the button is a joke that only shows a toast and
 * calls nothing. The counts stay so the owner can still see what is stored.
 */
export function FactoryReset({ counts }: { counts: ResetCounts }) {
  const toast = useToast();

  return (
    <Card className="border-danger/40">
      <CardHeader
        title={<span className="text-danger">Danger zone</span>}
        description="Clear every job, invoice, customer and supplier record.
        
        maybe not..."
      />

      <CardBody className="flex flex-col gap-4">
        <div className="rounded-md border border-line bg-canvas p-3">
          <p className="text-xs font-medium text-muted">Currently stored</p>
          <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <li className="flex justify-between gap-2">
              <span className="text-muted">Jobs</span>
              <span className="font-medium tabular">{counts.jobs}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Invoices</span>
              <span className="font-medium tabular">{counts.invoices}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Attachments</span>
              <span className="font-medium tabular">{counts.attachments}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Suppliers</span>
              <span className="font-medium tabular">{counts.suppliers}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Supplier bills</span>
              <span className="font-medium tabular">{counts.supplierEntries}</span>
            </li>
            <li className="flex justify-between gap-2">
              <span className="text-muted">Payments recorded</span>
              <span className="font-medium tabular">{counts.payments}</span>
            </li>
          </ul>
        </div>

        <Button
          variant="danger"
          onClick={() => toast.info('Relax bro, i removed functionality...')}
        >
          <AlertTriangle aria-hidden className="size-4" />
          Reset all data… (hopefully not)
        </Button>
      </CardBody>
    </Card>
  );
}
