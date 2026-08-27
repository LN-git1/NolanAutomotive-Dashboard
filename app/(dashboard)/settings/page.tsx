import type { Metadata } from 'next';

import { FactoryReset } from '@/components/settings/factory-reset';
import { SettingsForm } from '@/components/settings/settings-form';
import { TimeOffCard } from '@/components/settings/time-off';
import { Card, CardBody, CardHeader } from '@/components/ui';
import { getResetCounts } from '@/lib/db/queries/overview';
import { getSettings } from '@/lib/db/queries/settings';
import { listAllTimeOff } from '@/lib/db/queries/time-off';
import { peekNextNumber } from '@/lib/counters';
import { db } from '@/lib/db';
import { formatInvoiceNumber } from '@/lib/counters';

export const metadata: Metadata = { title: 'Settings' };
export const dynamic = 'force-dynamic';

const EXPORTS = [
  { href: '/api/export/jobs', label: 'Jobs', description: 'All jobs including customer and vehicle details' },
  { href: '/api/export/invoices', label: 'Invoices', description: 'Every invoice issued, with totals' },
  {
    href: '/api/export/supplier-bills',
    label: 'Supplier bills',
    description: 'Every supplier account entry — purchases added and money paid off',
  },
] as const;

export default async function SettingsPage() {
  const [settings, resetCounts, timeOffEntries] = await Promise.all([
    getSettings(),
    getResetCounts(),
    listAllTimeOff(),
  ]);

  // Shown so the owner can see where the sequence currently stands.
  let nextInvoiceNumber = '—';
  try {
    const next = await peekNextNumber(db, 'invoice');
    nextInvoiceNumber = formatInvoiceNumber(next, new Date().getFullYear());
  } catch {
    nextInvoiceNumber = 'Not initialised — run pnpm db:seed';
  }

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Settings</h1>
        <p className="text-sm text-muted">Business details, VAT and exports.</p>
      </div>

      <SettingsForm settings={settings} />

      <Card>
        <CardHeader
          title="Invoice numbering"
          description="Continuous and never reset — the year changes but the sequence keeps counting."
        />
        <CardBody>
          <p className="text-xs font-medium text-muted">Next invoice number</p>
          <p className="mt-1 text-lg font-semibold text-ink tabular">{nextInvoiceNumber}</p>
          <p className="mt-2 text-xs text-muted">
            Creating an invoice in the Invoicer uses this number immediately. Editing and
            re-sending an invoice afterwards keeps the same number, so the sequence stays free of
            gaps.
          </p>
        </CardBody>
      </Card>

      <TimeOffCard entries={timeOffEntries} />

      <Card>
        <CardHeader title="Data export" description="Downloads as CSV" />
        <CardBody className="flex flex-col gap-2">
          {EXPORTS.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2 hover:bg-canvas"
            >
              <span>
                <span className="block text-sm font-medium text-ink">{item.label}</span>
                <span className="block text-xs text-muted">{item.description}</span>
              </span>
              <span className="text-sm text-brand-dark">Download</span>
            </a>
          ))}
        </CardBody>
      </Card>

      <FactoryReset counts={resetCounts} />
    </div>
  );
}
