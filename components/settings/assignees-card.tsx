'use client';

import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, useTransition, type FormEvent } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Input } from '@/components/ui';
import { useToast } from '@/components/providers/toast-provider';
import { addAssignee, removeAssignee, renameAssignee } from '@/lib/actions/assignees';

interface Person {
  id: string;
  name: string;
  jobCount: number;
}

/**
 * The workshop team. Anyone added here can be ticked on a job and gets their own
 * line in Earnings. Removing someone who has worked jobs archives them rather
 * than deleting, so their history keeps a name — the toast says which happened.
 */
export function AssigneesCard({ people }: { people: Person[] }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);

  function run(task: () => Promise<{ ok: boolean; error?: string; archived?: boolean }>, done: (archived?: boolean) => void, failTitle: string) {
    setError(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        const message = result.error ?? 'Could not save that.';
        setError(message);
        toast.error(failTitle, message);
        return;
      }
      done(result.archived);
      router.refresh();
    });
  }

  function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);
    run(
      () => addAssignee(formData),
      () => {
        form.reset();
        toast.success('Person added', 'They can now be picked on a job.');
      },
      'Person not added',
    );
  }

  function handleRename(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    run(
      () => renameAssignee(id, formData),
      () => {
        setEditingId(null);
        toast.success('Name updated');
      },
      'Name not changed',
    );
  }

  function handleRemove(person: Person) {
    const note =
      person.jobCount > 0
        ? `${person.name} has worked on ${person.jobCount} job${person.jobCount === 1 ? '' : 's'}. They will be hidden from the picker but their past jobs and earnings stay.`
        : `Remove ${person.name}?`;
    if (!window.confirm(note)) return;
    run(
      () => removeAssignee(person.id),
      (archived) =>
        toast.success(
          archived ? `${person.name} archived` : `${person.name} removed`,
          archived ? 'Their past jobs and earnings are kept.' : undefined,
        ),
      'Person not removed',
    );
  }

  return (
    <Card>
      <CardHeader
        title="Workshop team"
        description="Who does the work. Pick them on each job and Earnings shows what each person brought in."
      />
      <CardBody className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}

        {people.length === 0 ? (
          <p className="text-sm text-muted">No one added yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {people.map((person) => (
              <li
                key={person.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                {editingId === person.id ? (
                  <form
                    onSubmit={(event) => handleRename(event, person.id)}
                    className="flex min-w-0 flex-1 items-center gap-2"
                  >
                    <Input
                      name="name"
                      defaultValue={person.name}
                      maxLength={60}
                      required
                      autoFocus
                      aria-label={`Name for ${person.name}`}
                    />
                    <button
                      type="submit"
                      disabled={pending}
                      aria-label="Save name"
                      className="shrink-0 rounded-md p-1.5 text-brand-dark hover:bg-canvas disabled:opacity-50"
                    >
                      <Check aria-hidden className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      aria-label="Cancel"
                      className="shrink-0 rounded-md p-1.5 text-muted hover:bg-canvas"
                    >
                      <X aria-hidden className="size-4" />
                    </button>
                  </form>
                ) : (
                  <>
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-ink">
                        {person.name}
                      </span>
                      <span className="block text-xs text-muted">
                        {person.jobCount === 0
                          ? 'No jobs yet'
                          : `${person.jobCount} job${person.jobCount === 1 ? '' : 's'}`}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => setEditingId(person.id)}
                        disabled={pending}
                        aria-label={`Edit ${person.name}`}
                        className="rounded-md p-1.5 text-muted hover:bg-canvas hover:text-ink disabled:opacity-50"
                      >
                        <Pencil aria-hidden className="size-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRemove(person)}
                        disabled={pending}
                        aria-label={`Remove ${person.name}`}
                        className="rounded-md p-1.5 text-muted hover:bg-danger-soft hover:text-danger disabled:opacity-50"
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}

        <form onSubmit={handleAdd} className="flex items-center gap-2">
          <Input name="name" placeholder="Add a person" maxLength={60} required aria-label="New person's name" />
          <Button type="submit" variant="secondary" disabled={pending} className="shrink-0">
            <Plus aria-hidden className="size-4" />
            Add
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
