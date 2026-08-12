'use client';

import { FileText, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

import {
  Alert,
  Button,
  buttonClass,
  Card,
  CardBody,
  CardHeader,
  Field,
  Input,
  Textarea,
} from '@/components/ui';
import { JobPicker, type InvoiceableJob } from '@/components/invoicer/job-picker';
import { SendBar, type FinalizedInvoice, type SendChannel } from '@/components/invoicer/send-bar';
import { calcInvoiceTotals, formatEur } from '@/lib/money';

interface PartRow {
  key: string;
  partName: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
}

function emptyRow(): PartRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    partName: '',
    partNumber: '',
    qty: '1',
    unitPrice: '',
  };
}

export function Invoicer({
  jobs,
  defaultHourlyRate,
  vatEnabled,
  vatRate,
  maxParts,
}: {
  jobs: InvoiceableJob[];
  defaultHourlyRate: string;
  vatEnabled: boolean;
  vatRate: string;
  maxParts: number;
}) {
  const router = useRouter();

  const [job, setJob] = useState<InvoiceableJob | null>(null);
  const [workCarriedOut, setWorkCarriedOut] = useState('');
  const [labourHours, setLabourHours] = useState('');
  const [hourlyRate, setHourlyRate] = useState(defaultHourlyRate);
  const [otherComments, setOtherComments] = useState('');
  const [parts, setParts] = useState<PartRow[]>([]);

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [generating, setGenerating] = useState(false);
  const [pendingChannel, setPendingChannel] = useState<SendChannel | null>(null);
  const [finalized, setFinalized] = useState<FinalizedInvoice | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Object URLs are a leak if not revoked when replaced or unmounted.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /** Live totals, computed with the same module the server uses. */
  const totals = useMemo(
    () =>
      calcInvoiceTotals({
        labourHours,
        hourlyRate,
        parts: parts
          .filter((row) => row.partName.trim() !== '')
          .map((row) => ({
            partName: row.partName,
            partNumber: row.partNumber,
            qty: row.qty || '0',
            unitPrice: row.unitPrice || '0',
          })),
        vatRate,
        vatEnabled,
      }),
    [labourHours, hourlyRate, parts, vatRate, vatEnabled],
  );

  function buildPayload() {
    return {
      jobId: job?.id ?? '',
      workCarriedOut,
      labourHours,
      hourlyRate,
      otherComments,
      parts: parts
        .filter((row) => row.partName.trim() !== '')
        .map((row) => ({
          partName: row.partName,
          partNumber: row.partNumber,
          qty: row.qty || '0',
          unitPrice: row.unitPrice || '0',
        })),
    };
  }

  async function handleGenerate() {
    if (!job) return;

    setError(null);
    setGenerating(true);

    try {
      const response = await fetch('/api/invoices/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildPayload()),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not generate the invoice.');
        return;
      }

      const blob = await response.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);

      setPreviewBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
    } finally {
      setGenerating(false);
    }
  }

  /**
   * First tap of the two-step send. Commits the invoice and returns the
   * authoritative PDF; the actual share happens on the next tap inside SendBar,
   * which is a fresh user gesture (required by navigator.share).
   */
  async function handleFinalize(channel: SendChannel) {
    if (!job || !previewBlob) return;

    setError(null);
    setPendingChannel(channel);

    try {
      const response = await fetch('/api/invoices/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...buildPayload(), sentVia: channel }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? 'Could not create the invoice.');
        return;
      }

      const blob = await response.blob();
      const invoiceNumber = response.headers.get('X-Invoice-Number') ?? '';
      const invoiceId = response.headers.get('X-Invoice-Id') ?? '';

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      setFinalized({ blob, invoiceNumber, invoiceId, channel });

      // The invoice is committed even if storing the PDF failed. Say so plainly
      // rather than letting the owner discover a broken link on the job later.
      if (response.headers.get('X-Storage-Failed') === '1') {
        setError(
          `Invoice ${invoiceNumber} was created, but the PDF could not be saved to storage. ` +
            `Download it now with the button below — the copy on the job page will be missing.`,
        );
      }

      router.refresh();
    } catch {
      setError('Could not reach the server. The invoice was not created.');
    } finally {
      setPendingChannel(null);
    }
  }

  function resetForNextInvoice() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setJob(null);
    setWorkCarriedOut('');
    setLabourHours('');
    setHourlyRate(defaultHourlyRate);
    setOtherComments('');
    setParts([]);
    setPreviewBlob(null);
    setPreviewUrl(null);
    setFinalized(null);
    setError(null);
  }

  const locked = finalized !== null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[26rem_1fr]">
      {/* ------------------------------------------------------------ form */}
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader title="1. Choose a job" description="Search by job number or customer name" />
          <CardBody>
            <JobPicker jobs={jobs} selected={job} onSelect={setJob} disabled={locked} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="2. Work and labour" />
          <CardBody className="flex flex-col gap-4">
            <Field label="Work carried out" htmlFor="workCarriedOut">
              <Textarea
                id="workCarriedOut"
                rows={5}
                value={workCarriedOut}
                disabled={locked}
                onChange={(event) => setWorkCarriedOut(event.target.value)}
                placeholder="Describe the work performed. This appears in the Services Performed section."
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Labour hours" htmlFor="labourHours">
                <Input
                  id="labourHours"
                  inputMode="decimal"
                  value={labourHours}
                  disabled={locked}
                  onChange={(event) => setLabourHours(event.target.value)}
                  placeholder="0"
                />
              </Field>

              <Field label="Hourly rate (€)" htmlFor="hourlyRate">
                <Input
                  id="hourlyRate"
                  inputMode="decimal"
                  value={hourlyRate}
                  disabled={locked}
                  onChange={(event) => setHourlyRate(event.target.value)}
                  placeholder="0.00"
                />
              </Field>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="3. Parts"
            description={`Up to ${maxParts} lines fit the template`}
            action={
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={locked || parts.length >= maxParts}
                onClick={() => setParts((rows) => [...rows, emptyRow()])}
              >
                <Plus aria-hidden className="size-4" />
                Add part
              </Button>
            }
          />
          <CardBody className="flex flex-col gap-3">
            {parts.length === 0 ? (
              <p className="text-sm text-muted">No parts added.</p>
            ) : (
              parts.map((row, index) => (
                <div key={row.key} className="rounded-md border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium text-muted">Line {index + 1}</span>
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={locked}
                      aria-label={`Remove line ${index + 1}`}
                      onClick={() => setParts((rows) => rows.filter((r) => r.key !== row.key))}
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Part name" htmlFor={`partName-${row.key}`} className="col-span-2">
                      <Input
                        id={`partName-${row.key}`}
                        value={row.partName}
                        disabled={locked}
                        onChange={(event) =>
                          setParts((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, partName: event.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>

                    <Field label="Part #" htmlFor={`partNumber-${row.key}`}>
                      <Input
                        id={`partNumber-${row.key}`}
                        value={row.partNumber}
                        disabled={locked}
                        onChange={(event) =>
                          setParts((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, partNumber: event.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>

                    <Field label="Qty" htmlFor={`qty-${row.key}`}>
                      <Input
                        id={`qty-${row.key}`}
                        inputMode="decimal"
                        value={row.qty}
                        disabled={locked}
                        onChange={(event) =>
                          setParts((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, qty: event.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>

                    <Field label="Unit price (€)" htmlFor={`unitPrice-${row.key}`} className="col-span-2">
                      <Input
                        id={`unitPrice-${row.key}`}
                        inputMode="decimal"
                        value={row.unitPrice}
                        disabled={locked}
                        onChange={(event) =>
                          setParts((rows) =>
                            rows.map((r) =>
                              r.key === row.key ? { ...r, unitPrice: event.target.value } : r,
                            ),
                          )
                        }
                      />
                    </Field>
                  </div>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="4. Other comments" />
          <CardBody>
            <Field label="Comments" htmlFor="otherComments">
              <Textarea
                id="otherComments"
                rows={3}
                value={otherComments}
                disabled={locked}
                onChange={(event) => setOtherComments(event.target.value)}
              />
            </Field>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Totals" description={vatEnabled ? `VAT at ${vatRate}%` : 'Not VAT registered'} />
          <CardBody className="flex flex-col gap-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Services</span>
              <span className="tabular">{formatEur(totals.servicesSubtotalCents)}</span>
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

        <div className="flex flex-wrap gap-2">
          <Button onClick={handleGenerate} disabled={!job || generating || locked}>
            {generating ? 'Generating…' : previewBlob ? 'Regenerate invoice' : 'Generate invoice'}
          </Button>

          {locked ? (
            <Button variant="secondary" onClick={resetForNextInvoice}>
              Start another invoice
            </Button>
          ) : null}
        </div>

        {!previewUrl ? (
          <Card>
            <div className="px-4 py-16 text-center text-sm text-muted">
              Choose a job and select <strong>Generate invoice</strong> to preview the PDF here.
              <br />
              Generating a preview does not create an invoice or use an invoice number.
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
            <div className="flex flex-col items-start gap-3 p-4 pb-28 md:hidden">
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
                Check it before sending — sending creates the invoice and uses an invoice number.
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

            <SendBar
              disabled={!previewBlob}
              finalized={finalized}
              onFinalize={handleFinalize}
              pendingChannel={pendingChannel}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
