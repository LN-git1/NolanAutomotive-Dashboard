import type { Metadata } from 'next';

import { JobForm } from '@/components/jobs/job-form';

export const metadata: Metadata = { title: 'New job' };

/**
 * The layout's `requireSession()` calls `cookies()`, which should opt this
 * subtree out of static generation anyway. Declaring it explicitly means the
 * per-request auth check does not depend on that inference holding.
 */
export const dynamic = 'force-dynamic';

export default function NewJobPage() {
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">New job</h1>
        <p className="text-sm text-muted">
          A job number is assigned automatically when the job is created.
        </p>
      </div>

      <JobForm />
    </div>
  );
}
