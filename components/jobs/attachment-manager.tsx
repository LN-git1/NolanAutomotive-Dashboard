'use client';

import { Paperclip, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert, Button, buttonClass, Empty } from '@/components/ui';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteAttachment, recordAttachment } from '@/lib/actions/jobs';
import type { JobAttachment } from '@/lib/db/schema';

function formatSize(bytes: number | null) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Upload flow, in three steps:
 *   1. ask our server for a signed upload URL,
 *   2. PUT the bytes straight to Supabase Storage (bypassing the 4.5MB
 *      serverless body cap),
 *   3. record the row via a server action.
 *
 * If step 2 or 3 fails the object may be orphaned in the bucket, which is
 * harmless — nothing references it and it is invisible without a signed URL.
 */
export function AttachmentManager({
  jobId,
  attachments,
}: {
  jobId: string;
  attachments: JobAttachment[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  /**
   * Files still in flight, newest first. Held by name so each one can be shown
   * as its own placeholder row — a photo taken on a phone can take a while over
   * a workshop connection, and "Uploading…" on a button gives no sense of how
   * many are left or that anything is actually happening.
   */
  const [inFlight, setInFlight] = useState<string[]>([]);
  const [pending, startTransition] = useTransition();

  /** One file's full pipeline: get a signed URL, PUT the bytes, record the row. */
  async function uploadOne(file: File): Promise<void> {
    // mimeType must match the Content-Type sent on the PUT below — R2 signs
    // the URL for that exact value and rejects a mismatch.
    const mimeType = file.type || 'application/octet-stream';

    const urlResponse = await fetch('/api/attachments/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'job', jobId, fileName: file.name, mimeType }),
    });

    if (!urlResponse.ok) {
      const body = (await urlResponse.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Could not start the upload for ${file.name}.`);
    }

    const { uploadUrl, storagePath } = (await urlResponse.json()) as {
      uploadUrl: string;
      storagePath: string;
    };

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file,
    });

    if (!putResponse.ok) {
      throw new Error(`Upload failed for ${file.name}.`);
    }

    const recorded = await recordAttachment({
      jobId,
      storagePath,
      fileName: file.name,
      mimeType: file.type || null,
      fileSizeBytes: file.size,
    });

    if (!recorded.ok) throw new Error(recorded.error ?? `Could not save ${file.name}.`);
  }

  /**
   * Files run concurrently, not one at a time.
   *
   * Each file's pipeline (signed URL -> PUT -> record) is independent of every
   * other file's, so a strictly sequential loop was paying for two extra
   * network round trips per file that could have overlapped with the next
   * file's transfer. On the slow workshop connection this app is built for,
   * that is real, avoidable time — several seconds across a typical batch of
   * job photos.
   *
   * `allSettled`, not `all`: one bad photo must not cancel the others that are
   * already partway through uploading, matching this file's own existing
   * tolerance for a partial failure leaving an orphaned object in R2.
   */
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    const fileList = Array.from(files);
    setError(null);
    setUploading(true);
    setInFlight(fileList.map((file) => file.name));

    const results = await Promise.allSettled(
      fileList.map((file) =>
        uploadOne(file).finally(() => {
          // Drop this file's placeholder as soon as IT lands, independent of
          // the others, so a batch of five visibly counts down as each
          // finishes rather than clearing all at once at the end.
          setInFlight((names) => names.filter((name) => name !== file.name));
        }),
      ),
    );

    const failures = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    if (failures.length > 0) {
      setError(
        failures.length === fileList.length
          ? failures[0]?.reason instanceof Error
            ? failures[0].reason.message
            : 'Upload failed.'
          : `${failures.length} of ${fileList.length} files failed to upload.`,
      );
    }

    if (failures.length < fileList.length) {
      // At least one file made it — refresh so it appears in the list.
      router.refresh();
    }

    setUploading(false);
    setInFlight([]);
  }

  /**
   * View and Download are plain links, NOT buttons that fetch and then call
   * `window.open()`.
   *
   * The previous version awaited a signed URL and opened it programmatically,
   * which browsers classify as a popup because it no longer runs inside the
   * click's own call stack. Desktop Chrome allows it; iOS Safari does not, and
   * inside the installed standalone PWA — how the owner actually uses this —
   * View silently did nothing at all.
   *
   * An anchor pointing at a route that redirects needs no JavaScript, so there
   * is no popup to block. `/api/invoices/[id]/pdf` has always worked this way.
   */
  const viewHref = (id: string) => `/api/attachments/${id}/signed-url?redirect=1`;
  const downloadHref = (id: string) => `/api/attachments/${id}/signed-url?redirect=1&download=1`;

  function handleDelete(attachment: JobAttachment) {
    if (!window.confirm(`Delete “${attachment.fileName}”? This cannot be undone.`)) return;

    startTransition(async () => {
      const result = await deleteAttachment(attachment.id);
      if (!result.ok) {
        setError(result.error ?? 'Could not delete the attachment.');
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      {error ? <Alert>{error}</Alert> : null}

      <div>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3.5 py-2 text-sm font-medium hover:bg-canvas">
          <Paperclip aria-hidden className="size-4" />
          {uploading ? 'Uploading…' : 'Add photos or receipts'}
          <input
            type="file"
            multiple
            className="visually-hidden"
            disabled={uploading}
            onChange={(event) => {
              void handleFiles(event.target.files);
              event.target.value = '';
            }}
          />
        </label>
      </div>

      {/*
        In-flight uploads sit above the saved list as real rows carrying the
        file's own name, so the owner can see exactly which photo is still
        going up rather than a generic spinner.
      */}
      {inFlight.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line border-b border-line">
          {inFlight.map((name) => (
            <li key={name} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-muted">{name}</p>
                <p className="text-xs text-muted">Uploading…</p>
              </div>
              {/* h-10, matching the sm button's new min-h-10, so the real
                  buttons don't jump the row taller when they replace this. */}
              <Skeleton className="h-10 w-24 shrink-0 rounded-md" />
            </li>
          ))}
        </ul>
      ) : null}

      {attachments.length === 0 && inFlight.length === 0 ? (
        <Empty>No attachments yet.</Empty>
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm text-ink">{attachment.fileName}</p>
                <p className="text-xs text-muted">{formatSize(attachment.fileSizeBytes)}</p>
              </div>

              {/* gap-2, not gap-1 — three tappable targets in a row need more
                  than 4px between them to not be a mis-tap magnet. */}
              <div className="flex shrink-0 gap-2">
                <a
                  href={viewHref(attachment.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass('secondary', 'sm')}
                  aria-label={`View ${attachment.fileName}`}
                >
                  View
                </a>
                <a
                  href={downloadHref(attachment.id)}
                  className={buttonClass('secondary', 'sm')}
                  aria-label={`Download ${attachment.fileName}`}
                >
                  Download
                </a>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={pending}
                  onClick={() => handleDelete(attachment)}
                  aria-label={`Delete ${attachment.fileName}`}
                >
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
