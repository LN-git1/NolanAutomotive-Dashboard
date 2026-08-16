import type { Metadata } from 'next';

import { JobForm } from '@/components/jobs/job-form';
import { getSettings } from '@/lib/db/queries/settings';
import { labourRowCapacity, partsRowCapacity } from '@/lib/pdf/stamp';

export const metadata: Metadata = { title: 'New job' };

/**
 * The layout's `requireSession()` calls `cookies()`, which should opt this
 * subtree out of static generation anyway. Declaring it explicitly means the
 * per-request auth check does not depend on that inference holding.
 */
export const dynamic = 'force-dynamic';

export default async function NewJobPage() {
  // The owner's usual rate prefills the labour box, so a straightforward job
  // needs only the hours typing in.
  const settings = await getSettings();

  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">New job</h1>
        <p className="text-sm text-muted">
          A job number is assigned automatically when the job is created.
        </p>
      </div>

      <JobForm
        defaultHourlyRate={settings.defaultHourlyRate ?? ''}
        labourCapacity={labourRowCapacity()}
        partsCapacity={partsRowCapacity()}
      />
    </div>
  );
}
