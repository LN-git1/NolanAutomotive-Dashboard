'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui';
import { useToast } from '@/components/providers/toast-provider';
import { deleteSupplierEntry } from '@/lib/actions/suppliers';

/**
 * Removing one line from a supplier's account.
 *
 * Delete is the only action left on a line. Marking money paid used to live
 * here, one switch per bill; it now belongs to the account as a whole
 * (`SupplierAccountActions`), because a payment rarely lines up with a single
 * docket — it comes off the balance.
 */
export function EntryActions({ entryId, label }: { entryId: string; label: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const toast = useToast();

  function remove() {
    if (!window.confirm(`Delete ${label}? This changes the balance and cannot be undone.`)) return;

    startTransition(async () => {
      const result = await deleteSupplierEntry(entryId);
      if (!result.ok) {
        toast.error('Entry not deleted', result.error ?? 'Could not delete the entry.');
        return;
      }
      toast.success('Entry deleted', label);
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end">
      <Button
        size="sm"
        variant="danger"
        onClick={remove}
        disabled={pending}
        aria-label={`Delete ${label}`}
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
