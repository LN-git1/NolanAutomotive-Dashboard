'use client';

import { Paperclip } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { useToast } from '@/components/providers/toast-provider';
import { attachSupplierReceipt } from '@/lib/actions/suppliers';
import { redirectIfUnauthorized } from '@/lib/client/session';

/**
 * Put a receipt on a purchase that was recorded without one. The file goes
 * straight to storage with a one-shot signed URL, exactly as when a purchase is
 * added with a receipt; then the server is told where it is.
 *
 * Styled like the "Choose file" control on the purchase form, so it looks like
 * the same thing.
 */
export function AddReceipt({ entryId, supplierId }: { entryId: string; supplierId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  async function upload(file: File): Promise<string> {
    // Must match the Content-Type on the PUT below: storage signs for that value.
    const mimeType = file.type || 'application/octet-stream';

    const urlResponse = await fetch('/api/attachments/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'supplier-bill', supplierId, fileName: file.name, mimeType }),
    });
    if (!urlResponse.ok) {
      redirectIfUnauthorized(urlResponse);
      throw new Error('Could not start the receipt upload.');
    }

    const { uploadUrl, storagePath } = (await urlResponse.json()) as { uploadUrl: string; storagePath: string };

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file,
    });
    if (!putResponse.ok) throw new Error('Receipt upload failed.');
    return storagePath;
  }

  function handleFile(file: File | undefined) {
    if (!file) return;

    startTransition(async () => {
      try {
        setUploading(true);
        const storagePath = await upload(file);
        const result = await attachSupplierReceipt(entryId, storagePath);
        if (!result.ok) {
          toast.error('Receipt not added', result.error ?? 'Could not attach the receipt.');
          return;
        }
        toast.success('Receipt added');
        router.refresh();
      } catch (error) {
        toast.error('Receipt not added', error instanceof Error ? error.message : 'Could not attach the receipt.');
      } finally {
        setUploading(false);
      }
    });
  }

  const busy = pending || uploading;

  return (
    <label
      className={
        'inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium hover:bg-canvas' +
        (busy ? ' pointer-events-none opacity-60' : '')
      }
    >
      <Paperclip aria-hidden className="size-3.5" />
      {busy ? 'Uploading…' : 'Add receipt'}
      <input
        type="file"
        className="visually-hidden"
        disabled={busy}
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          // Allow choosing the same file again if the upload failed.
          event.target.value = '';
        }}
      />
    </label>
  );
}
