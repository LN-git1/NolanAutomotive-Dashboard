import type { Metadata } from 'next';

import { JobForm } from '@/components/jobs/job-form';

export const metadata: Metadata = { title: 'New job' };

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
