'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input } from '@/components/ui';
import { addTimeOff, deleteTimeOff } from '@/lib/actions/time-off';
import { formatDate } from '@/lib/format';
import type { TimeOff } from '@/lib/db/schema';

/**
 * The one real modal in this app. Everywhere else a reveal is inline
 * (`factory-reset.tsx`, `mark-paid-button.tsx`) specifically because
 * `components/ui/index.tsx` has no `'use client'` directive by design, and a
 * shared Modal living there would force every consumer of that barrel to
 * become client-side. This component sidesteps that entirely by living on
 * its own, outside the barrel — nothing else imports it, so nothing else is
 * affected.
 */
export function TimeOffCard({ entries }: { entries: TimeOff[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function closeModal() {
    setOpen(false);
    setError(null);
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await addTimeOff(formData);
      if (!result.ok) {
        setError(result.error ?? 'Could not add time off');
        return;
      }
      closeModal();
      router.refresh();
    });
  }

  function handleDelete(id: string) {
    setDeletingId(id);
    startTransition(async () => {
      await deleteTimeOff(id);
      setDeletingId(null);
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader
        title="Time off"
        description="Days you're not available — struck off the Schedule calendar."
      />

      <CardBody className="flex flex-col gap-3">
        {entries.length === 0 ? (
          <p className="text-sm text-muted">No time off booked.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-ink">
                    {formatDate(entry.startDate)}
                    {entry.startDate !== entry.endDate ? ` – ${formatDate(entry.endDate)}` : ''}
                  </span>
                  {entry.label ? (
                    <span className="block truncate text-xs text-muted">{entry.label}</span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => handleDelete(entry.id)}
                  disabled={pending}
                  aria-label="Remove time off"
                  className="shrink-0 rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                >
                  {deletingId === entry.id ? (
                    <span className="block size-4 animate-pulse rounded-full bg-current" />
                  ) : (
                    <Trash2 aria-hidden className="size-4" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}

        <Button type="button" variant="secondary" onClick={() => setOpen(true)} className="self-start">
          <Plus aria-hidden className="size-4" />
          Add time off
        </Button>
      </CardBody>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Add time off"
            className="w-full max-w-sm rounded-lg border border-line bg-surface p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Add time off</h2>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close"
                className="rounded-md p-1 text-muted hover:bg-canvas"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {error ? (
              <div className="mb-3">
                <Alert>{error}</Alert>
              </div>
            ) : null}

            <form onSubmit={handleAdd} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start date" htmlFor="startDate">
                  <Input id="startDate" name="startDate" type="date" required />
                </Field>
                <Field label="End date" htmlFor="endDate">
                  <Input id="endDate" name="endDate" type="date" required />
                </Field>
              </div>

              <Field label="Label" htmlFor="label" hint='Optional — e.g. "Family holiday"'>
                <Input id="label" name="label" maxLength={100} />
              </Field>

              <div className="flex gap-2">
                <Button type="submit" disabled={pending}>
                  {pending ? 'Saving…' : 'Save'}
                </Button>
                <Button type="button" variant="secondary" onClick={closeModal} disabled={pending}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
