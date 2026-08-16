'use client';

import { Paperclip, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { Alert, Button, Empty } from '@/components/ui';
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

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;

    setError(null);
    setUploading(true);
    setInFlight(Array.from(files).map((file) => file.name));

    try {
      for (const file of Array.from(files)) {
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
          throw new Error(body?.error ?? 'Could not start the upload.');
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

        if (!recorded.ok) throw new Error(recorded.error ?? 'Could not save the attachment.');

        // Drop this file's placeholder as soon as it lands, so uploading five
        // photos visibly counts down rather than clearing all at once.
        setInFlight((names) => names.filter((name) => name !== file.name));
      }

      router.refresh();
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload failed.');
    } finally {
      setUploading(false);
      setInFlight([]);
    }
  }

  async function openAttachment(id: string, download: boolean) {
    setError(null);

    const response = await fetch(`/api/attachments/${id}/signed-url${download ? '?download=1' : ''}`);
    if (!response.ok) {
      setError('Could not open that file.');
      return;
    }

    const { url } = (await response.json()) as { url: string };
    window.open(url, '_blank', 'noopener,noreferrer');
  }

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
              <Skeleton className="h-8 w-24 shrink-0 rounded-md" />
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

              <div className="flex shrink-0 gap-1">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void openAttachment(attachment.id, false)}
                >
                  View
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void openAttachment(attachment.id, true)}
                >
                  Download
                </Button>
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
