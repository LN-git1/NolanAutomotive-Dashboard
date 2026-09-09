'use client';

import { useRef, useState, useTransition } from 'react';

import { Alert, Button, Card, CardBody, Field, Input, Select, Textarea } from '@/components/ui';
import { addExpense } from '@/lib/actions/expenses';
import { todayIsoDate } from '@/lib/format';
import { EXPENSE_CATEGORIES, EXPENSE_CATEGORY_LABELS } from '@/lib/validation/expense';

/**
 * Record a running cost. Posts FormData to `addExpense`, which validates and
 * dedupes by the hidden submission key — double-taps insert once.
 *
 * No photo input here on purpose: a receipt path needs the expense id, which
 * only exists after the insert, so receipts are added from the expanded
 * expense row instead.
 */
export function ExpenseForm({ onSaved }: { onSaved?: () => void }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Minted once per mount, refreshed after each save — never per render, or a
  // re-render between taps would defeat the server-side dedupe.
  const [submissionKey, setSubmissionKey] = useState(() => crypto.randomUUID());

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await addExpense(formData);
      if (!result.ok) {
        setError(result.error ?? 'Could not save the expense.');
        return;
      }
      formRef.current?.reset();
      setSubmissionKey(crypto.randomUUID());
      onSaved?.();
    });
  }

  return (
    <Card>
      <CardBody>
        <form ref={formRef} onSubmit={handleSubmit} className="flex flex-col gap-4">
          <p className="text-sm font-medium text-ink">Add expense</p>
          {error ? <Alert>{error}</Alert> : null}

          <input type="hidden" name="submissionKey" value={submissionKey} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Amount (€)" htmlFor="expense-amount" required>
              <Input
                id="expense-amount"
                name="amount"
                inputMode="decimal"
                placeholder="0.00"
                required
              />
            </Field>

            <Field label="Date" htmlFor="expense-date" required>
              <Input
                id="expense-date"
                name="expenseDate"
                type="date"
                defaultValue={todayIsoDate()}
                required
              />
            </Field>
          </div>

          <Field label="Category" htmlFor="expense-category" required>
            <Select id="expense-category" name="category" defaultValue="other" required>
              {EXPENSE_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {EXPENSE_CATEGORY_LABELS[category]}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Note" htmlFor="expense-note" hint="What was this for?">
            <Textarea id="expense-note" name="note" rows={2} />
          </Field>

          <div>
            <Button type="submit" disabled={pending}>
              {pending ? 'Saving…' : 'Add expense'}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
