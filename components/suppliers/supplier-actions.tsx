'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui';
import { useToast } from '@/components/providers/toast-provider';
import { deleteSupplier } from '@/lib/actions/suppliers';

/**
 * Unlike `EntryActions`, this surfaces a failed delete rather than discarding
 * the result silently — a failed entry delete just leaves the row visible, but
 * a failed supplier delete (on the detail page) is followed by leaving the
 * page, so silence here would mean the owner never sees why the supplier is
 * still there.
 */
export function SupplierActions({
  supplierId,
  name,
  redirectOnDelete = false,
}: {
  supplierId: string;
  name: string;
  /** Detail-page usage: the current page's data is gone once this succeeds. */
  redirectOnDelete?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function remove() {
    if (!window.confirm(`Delete ${name}? This also deletes their whole bill history and cannot be undone.`)) {
      return;
    }

    startTransition(async () => {
      const result = await deleteSupplier(supplierId);
      if (!result.ok) {
        toast.error('Supplier not deleted', result.error ?? 'Could not delete the supplier.');
        return;
      }

      toast.success('Supplier deleted', name);
      if (redirectOnDelete) {
        router.replace('/suppliers');
      }
      router.refresh();
    });
  }

  return (
    <Button
      size="sm"
      variant="danger"
      onClick={remove}
      disabled={pending}
      aria-label={`Delete ${name}`}
    >
      <Trash2 aria-hidden className="size-4" />
    </Button>
  );
}
