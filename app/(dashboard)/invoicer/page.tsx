import type { Metadata } from 'next';

import { Invoicer } from '@/components/invoicer/invoicer';
import { listInvoiceableJobs } from '@/lib/db/queries/jobs';
import { getSettings } from '@/lib/db/queries/settings';

export const metadata: Metadata = { title: 'Invoicer' };
export const dynamic = 'force-dynamic';

export default async function InvoicerPage() {
  const [jobs, settings] = await Promise.all([listInvoiceableJobs(), getSettings()]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Invoicer</h1>
        <p className="text-sm text-muted">
          Generates the invoice onto the Nolan Automotive template. The details come from the job —
          previewing is free, and an invoice number is only used when you send it.
        </p>
      </div>

      <Invoicer
        jobs={jobs}
        vatEnabled={settings.vatRegistered}
        vatRate={settings.defaultVatRate}
      />
    </div>
  );
}
