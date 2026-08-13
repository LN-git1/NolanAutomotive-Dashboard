'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';

import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { addSupplierBill } from '@/lib/actions/suppliers';
import { todayIsoDate } from '@/lib/format';

/**
 * Add a bill, optionally with a receipt attached.
 *
 * The attachment follows the same direct-to-Storage route as job attachments:
 * signed URL from our server, bytes straight to Supabase, then the row is
 * written with the resulting path.
 */
export function BillForm({ supplierId }: { supplierId: string }) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  async function uploadAttachment(file: File): Promise<string | null> {
    // Must match the Content-Type on the PUT below — R2 signs for that value.
    const mimeType = file.type || 'application/octet-stream';

    const urlResponse = await fetch('/api/attachments/upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'supplier-bill', supplierId, fileName: file.name, mimeType }),
    });

    if (!urlResponse.ok) throw new Error('Could not start the receipt upload.');

    const { uploadUrl, storagePath } = (await urlResponse.json()) as {
      uploadUrl: string;
      storagePath: string;
    };

    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': mimeType },
      body: file,
    });

    if (!putResponse.ok) throw new Error('Receipt upload failed.');
    return storagePath;
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const file = formData.get('attachment');
    formData.delete('attachment');
    formData.set('supplierId', supplierId);

    startTransition(async () => {
      try {
        if (file instanceof File && file.size > 0) {
          setUploading(true);
          const storagePath = await uploadAttachment(file);
          if (storagePath) formData.set('attachmentStoragePath', storagePath);
        }

        const result = await addSupplierBill(formData);
        if (!result.ok) {
          setError(result.error ?? 'Could not add the bill.');
          return;
        }

        formRef.current?.reset();
        router.refresh();
      } catch (submitError) {
        setError(submitError instanceof Error ? submitError.message : 'Could not add the bill.');
      } finally {
        setUploading(false);
      }
    });
  }

  const busy = pending || uploading;

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      {error ? <Alert>{error}</Alert> : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Amount (€)" htmlFor="amount" required>
          <Input id="amount" name="amount" inputMode="decimal" placeholder="0.00" required />
        </Field>

        <Field label="Bill date" htmlFor="billDate" required>
          <Input
            id="billDate"
            name="billDate"
            type="date"
            defaultValue={todayIsoDate()}
            required
          />
        </Field>
      </div>

      <Field label="Reference" htmlFor="reference" hint="Invoice or docket number">
        <Input id="reference" name="reference" />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <Field label="Receipt" htmlFor="attachment" hint="Optional photo or PDF">
        <Input id="attachment" name="attachment" type="file" className="py-1.5" />
      </Field>

      <Button type="submit" disabled={busy}>
        {uploading ? 'Uploading receipt…' : pending ? 'Saving…' : 'Add bill'}
      </Button>
    </form>
  );
}
