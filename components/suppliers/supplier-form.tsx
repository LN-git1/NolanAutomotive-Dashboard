'use client';

import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';

import { Alert, Button, Field, Input, Textarea } from '@/components/ui';
import { createSupplier } from '@/lib/actions/suppliers';

export function SupplierForm() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await createSupplier(formData);
      if (!result.ok) {
        setError(result.error ?? 'Could not add the supplier.');
        return;
      }
      formRef.current?.reset();
      router.refresh();
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4 p-4">
      {error ? <Alert>{error}</Alert> : null}

      <Field label="Supplier name" htmlFor="name" required>
        <Input id="name" name="name" required />
      </Field>

      <Field label="Notes" htmlFor="notes">
        <Textarea id="notes" name="notes" rows={2} />
      </Field>

      <Button type="submit" disabled={pending}>
        {pending ? 'Adding…' : 'Add supplier'}
      </Button>
    </form>
  );
}
