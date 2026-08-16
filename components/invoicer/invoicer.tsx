'use client';

import { FileText, Pencil } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import { Alert, Button, buttonClass, Card, CardBody, CardHeader } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { JobPicker, type InvoiceableJob } from '@/components/invoicer/job-picker';
import { SendBar, type IssuedInvoice, type SendChannel } from '@/components/invoicer/send-bar';
import { calcInvoiceTotals, formatEur, formatHours } from '@/lib/money';

/**
 * The Invoicer is now a thin step: choose a job, check the PDF, send it.
 *
 * Nothing about the invoice is editable here. The work, labour, parts and
 * comments all live on the job, which is what makes an invoice re-generatable —
 * there is exactly one place the content can be changed, so the document and the
 * job can never drift apart.
 */
export function Invoicer({
  jobs,
  vatEnabled,
  vatRate,
}: {
  jobs: InvoiceableJob[];
  vatEnabled: boolean;
  vatRate: string;
}) {
  const router = useRouter();

  const [job, setJob] = useState<InvoiceableJob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [issued, setIssued] = useState<IssuedInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Object URLs are a leak if not revoked when replaced or unmounted.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /** Totals shown read-only, computed with the same module the server uses. */
  const totals = useMemo(
    () =>
      calcInvoiceTotals({
        labourLines: job?.labourLines ?? [],
        hourlyRate: job?.hourlyRate,
        labourTotalOverride: job?.labourTotalOverride,
        parts: job?.parts ?? [],
        vatRate,
        vatEnabled,
      }),
    [job, vatRate, vatEnabled],
  );

  const isResend = Boolean(job?.liveInvoiceId);
  const hasContent =
    (job?.labourLines.length ?? 0) > 0 || (job?.parts.length ?? 0) > 0;

  /**
   * Re-sending overwrites the stored PDF in place, so an empty job would replace
   * a real invoice with a blank one. The server refuses this outright; blocking
   * it here too means the owner sees a disabled button and a reason rather than
   * discovering the rule by way of an error after tapping send.
   */
  const wouldBlankInvoice = isResend && !hasContent;

  function selectJob(next: InvoiceableJob | null) {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setJob(next);
    setPreviewUrl(null);
    setIssued(null);
    setError(null);
    setNotice(null);
  }

  async function handleGenerate() {
    if (!job) return;

    setError(null);
    setGenerating(true);

    try {
      const response = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not generate the invoice.');
        return;
      }

      const blob = await response.blob();
      const invoiceNumber = response.headers.get('X-Invoice-Number') ?? '';
      const invoiceId = response.headers.get('X-Invoice-Id') ?? '';
      const reissued = response.headers.get('X-Invoice-Reissued') === '1';

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(URL.createObjectURL(blob));
      setIssued({ blob, invoiceNumber, invoiceId });

      setNotice(
        reissued
          ? `Invoice ${invoiceNumber} was updated in place — same number, and the stored copy has been replaced.`
          : null,
      );

      // Committed even if the upload failed. Say so plainly rather than letting
      // the owner find a broken link on the job later.
      if (response.headers.get('X-Storage-Failed') === '1') {
        setError(
          `Invoice ${invoiceNumber} was created, but the PDF could not be saved to storage. ` +
            `Send it now with the buttons below — the copy on the job page will be missing.`,
        );
      }

      // The job is now Invoiced; refresh so the picker and lists agree.
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  }

  /**
   * Record delivery. Deliberately fire-and-forget: the platform has already been
   * opened by the time this resolves, and a slow network must never sit between
   * the owner's tap and WhatsApp appearing.
   */
  function handleSent(channel: SendChannel) {
    if (!issued) return;

    void fetch(`/api/invoices/${issued.invoiceId}/sent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sentVia: channel }),
      keepalive: true,
    })
      .then(() => router.refresh())
      .catch(() => {
        // The invoice exists and the customer has it; failing to record HOW it
        // was sent is not worth interrupting the owner over.
      });
  }

  const locked = issued !== null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[26rem_1fr]">
      {/* ---------------------------------------------------- job + summary */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="1. Choose a job" description="Search by job number or customer name" />
          <CardBody>
            <JobPicker jobs={jobs} selected={job} onSelect={selectJob} disabled={locked} />
          </CardBody>
        </Card>

        {job ? (
          <Card>
            <CardHeader
              title="2. Check the details"
              description="Entered on the job — edit them there"
              action={
                <Link href={`/jobs/${job.id}`} className={buttonClass('secondary', 'sm')}>
                  <Pencil aria-hidden className="size-4" />
                  Edit job
                </Link>
              }
            />
            <CardBody className="flex flex-col gap-4">
              {!hasContent ? (
                <Alert>
                  This job has no work lines or parts yet. Add them on the job before invoicing.
                </Alert>
              ) : null}

              <div className="flex flex-col gap-1 text-sm">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  Work carried out
                </p>
                {job.labourLines.length === 0 ? (
                  <p className="text-muted">None entered.</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {job.labourLines.map((line, index) => (
                      <li key={index} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate text-ink">{line.description}</span>
                        <span className="shrink-0 text-muted tabular">{line.hours}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="flex flex-col gap-1 text-sm">
                <p className="text-xs font-medium tracking-wide text-muted uppercase">
                  Parts ({job.parts.length})
                </p>
                {job.parts.length === 0 ? (
                  <p className="text-muted">None entered.</p>
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {job.parts.map((part, index) => (
                      <li key={index} className="flex justify-between gap-3">
                        <span className="min-w-0 truncate text-ink">{part.partName}</span>
                        <span className="shrink-0 text-muted tabular">
                          {part.qty} × €{part.unitPrice}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Totals"
            description={vatEnabled ? `VAT at ${vatRate}%` : 'Not VAT registered'}
          />
          <CardBody className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">
                Labour{totals.labourIsOverridden ? ' (custom)' : ` (${formatHours(totals.totalHoursCentis)} h)`}
              </span>
              <span className="tabular">{formatEur(totals.labourSubtotalCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Parts</span>
              <span className="tabular">{formatEur(totals.partsSubtotalCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">VAT</span>
              <span className="tabular">{formatEur(totals.totalTaxCents)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-line pt-2 font-semibold">
              <span>Total</span>
              <span className="tabular">{formatEur(totals.grandTotalCents)}</span>
            </div>
          </CardBody>
        </Card>
      </div>

      {/* --------------------------------------------------------- preview */}
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {notice && !error ? <Alert>{notice}</Alert> : null}

        {wouldBlankInvoice && !locked ? (
          <Alert>
            {job?.liveInvoiceNumber} cannot be re-sent while this job has no work lines or parts —
            doing so would replace the customer&apos;s copy with a blank invoice. Add the work back
            on the job, or void {job?.liveInvoiceNumber} if it was issued in error.
          </Alert>
        ) : isResend && !locked ? (
          <Alert>
            This job already has invoice {job?.liveInvoiceNumber}. Sending again keeps that number
            and replaces the stored PDF.
          </Alert>
        ) : null}

        <div className="flex flex-wrap gap-2">
          {/*
            Stays enabled after the invoice exists: that is exactly when "Update
            invoice" is useful — edit the job, come back, restamp under the same
            number. It is only blocked while a stamp is in flight, or when
            regenerating would replace a real invoice with a blank one.
          */}
          <Button onClick={handleGenerate} disabled={!job || generating || wouldBlankInvoice}>
            {generating ? 'Creating…' : issued ? 'Update invoice' : 'Create invoice'}
          </Button>

          {locked ? (
            <Button variant="secondary" onClick={() => selectJob(null)}>
              Start another invoice
            </Button>
          ) : null}
        </div>

        {generating && !previewUrl ? (
          /*
           * Stamping takes ten seconds or more on a cold function — long enough
           * that a dimmed button alone reads as nothing happening. This shows
           * the shape of the document being built, at the same height as the
           * real preview, so the pane does not jump when it arrives.
           */
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-3 p-4" aria-hidden>
              <Skeleton className="h-4 w-48" />
              <div className="flex flex-col gap-2 rounded-md border border-line p-4">
                <div className="flex items-start justify-between gap-4">
                  <Skeleton className="h-6 w-40" />
                  <Skeleton className="h-6 w-24" />
                </div>
                <Skeleton className="h-3 w-56 max-w-full" />
                <div className="mt-4 grid grid-cols-2 gap-4">
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-3.5 w-full" />
                    ))}
                  </div>
                  <div className="flex flex-col gap-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-3.5 w-full" />
                    ))}
                  </div>
                </div>
                <div className="mt-6 flex flex-col gap-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-4 w-full" />
                  ))}
                </div>
                <div className="mt-4 flex flex-col items-end gap-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-5 w-48" />
                </div>
              </div>
            </div>
            <p role="status" aria-live="polite" className="px-4 pb-4 text-center text-sm text-muted">
              Building the invoice PDF…
            </p>
          </Card>
        ) : !previewUrl ? (
          <Card>
            <div className="px-4 py-16 text-center text-sm text-muted">
              Choose a job and select <strong>Create invoice</strong>.
              <br />
              The invoice is created straight away, so sending it afterwards is instant.
            </div>
          </Card>
        ) : (
          <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/*
              iOS Safari does not render PDFs inside <object>/<iframe> — it shows
              a blank box. Since the phone is the primary device here, small
              screens get an explicit "open in the PDF viewer" action instead of
              an embed that silently fails, and the embed is used from md up.
            */}
            {/* pb-28 keeps this clear of the sticky send bar floating above it. */}
            <div className="flex flex-col items-start gap-3 p-4 pb-24 md:hidden">
              <p className="text-sm text-ink">
                Invoice ready to preview. It opens in your phone&apos;s PDF viewer.
              </p>
              <a
                href={previewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('secondary', 'md')}
              >
                <FileText aria-hidden className="size-4" />
                Open invoice preview
              </a>
              <p className="text-xs text-muted">
                Check it, then send it below. Creating it again after editing the job keeps the same number.
              </p>
            </div>

            <object
              data={previewUrl}
              type="application/pdf"
              className="hidden h-[70vh] w-full md:block"
              aria-label="Invoice preview"
            >
              <div className="p-4 text-sm text-muted">
                This browser cannot display PDFs inline.{' '}
                <a
                  href={previewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-brand-dark underline"
                >
                  Open the preview in a new tab
                </a>
                .
              </div>
            </object>

            {/* Only once the invoice exists — which, now, is as soon as it is
                generated. There is nothing left to commit. */}
            {issued && job ? (
              <SendBar
                invoice={issued}
                recipient={{
                  customerName: job.customerName,
                  customerEmail: job.customerEmail,
                  customerPhone: job.customerPhone,
                  vehicleRegistration: job.vehicleRegistration,
                }}
                onSent={handleSent}
              />
            ) : null}
          </Card>
        )}
      </div>
    </div>
  );
}
