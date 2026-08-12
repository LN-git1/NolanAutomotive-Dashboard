'use client';

import { Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTransition } from 'react';

import { Button } from '@/components/ui';
import { deleteSupplierBill, setBillPaid } from '@/lib/actions/suppliers';

export function BillActions({
  billId,
  paid,
  reference,
}: {
  billId: string;
  paid: boolean;
  reference: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function togglePaid() {
    startTransition(async () => {
      await setBillPaid(billId, !paid);
      router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Delete bill ${reference}? This cannot be undone.`)) return;

    startTransition(async () => {
      await deleteSupplierBill(billId);
      router.refresh();
    });
  }

  return (
    <div className="flex justify-end gap-1">
      <Button size="sm" variant="secondary" onClick={togglePaid} disabled={pending}>
        {paid ? 'Mark unpaid' : 'Mark paid'}
      </Button>
      <Button
        size="sm"
        variant="danger"
        onClick={remove}
        disabled={pending}
        aria-label={`Delete bill ${reference}`}
      >
        <Trash2 aria-hidden className="size-4" />
      </Button>
    </div>
  );
}
