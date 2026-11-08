import type { JobPartLine, LabourLine } from '@/lib/db/schema';

export type JobWork = {
  /** "Ford Focus 2016 · Blue · 142-KY-9821", or empty. */
  vehicle: string;
  customer: string;
  labour: LabourLine[];
  parts: JobPartLine[];
  comments: string | null;
};

/**
 * Builds the work summary from a job row: the same text that goes on the
 * invoice (work carried out, parts, other comments), without prices. Blank
 * lines the owner left in the form are dropped, as the invoice does.
 * The job's private notes are never included: they are not for the invoice.
 */
export function jobWorkFromJob(job: {
  customerName: string;
  vehicleRegistration: string;
  vehicleMake: string | null;
  vehicleModel: string | null;
  vehicleYear: number | null;
  vehicleColor: string | null;
  labourLines: LabourLine[] | null;
  parts: JobPartLine[] | null;
  otherComments: string | null;
}): JobWork {
  const makeModel = [job.vehicleMake, job.vehicleModel].filter(Boolean).join(' ');
  return {
    vehicle: [makeModel, job.vehicleYear, job.vehicleColor, job.vehicleRegistration]
      .filter((part) => part !== null && part !== undefined && part !== '')
      .join(' · '),
    customer: job.customerName,
    labour: (job.labourLines ?? []).filter((line) => line.description.trim() !== ''),
    parts: (job.parts ?? []).filter((part) => part.partName.trim() !== ''),
    comments: job.otherComments?.trim() ? job.otherComments.trim() : null,
  };
}

/**
 * What needs doing on a job, readable at a glance: the work carried out, the
 * parts, and any other comments. Plain text only, no prices, so a mechanic can
 * see what is needed without opening the job. Server-safe: no state.
 */
export function JobWorkSummary({ work }: { work: JobWork }) {
  const empty = work.labour.length === 0 && work.parts.length === 0 && work.comments === null;

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div>
        {work.vehicle ? <p className="font-medium text-ink">{work.vehicle}</p> : null}
        <p className="text-xs text-muted">{work.customer}</p>
      </div>

      {empty ? <p className="text-xs text-muted">No work or parts entered on this job yet.</p> : null}

      {work.labour.length > 0 ? (
        <section aria-label="Work carried out">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Work carried out</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {work.labour.map((line, index) => (
              <li key={index} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ink">{line.description}</span>
                {line.hours.trim() !== '' ? (
                  <span className="shrink-0 text-xs text-muted tabular">{line.hours} h</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {work.parts.length > 0 ? (
        <section aria-label="Parts">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Parts</h3>
          <ul className="mt-1 flex flex-col gap-1">
            {work.parts.map((part, index) => (
              <li key={index} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 text-ink">
                  {part.partName}
                  {part.partNumber.trim() !== '' ? (
                    <span className="text-xs text-muted"> · {part.partNumber}</span>
                  ) : null}
                </span>
                {part.qty.trim() !== '' ? (
                  <span className="shrink-0 text-xs text-muted tabular">× {part.qty}</span>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {work.comments ? (
        <section aria-label="Other comments">
          <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">Other comments</h3>
          <p className="mt-1 whitespace-pre-wrap text-ink">{work.comments}</p>
        </section>
      ) : null}
    </div>
  );
}
