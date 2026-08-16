'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { Button, Field, Input } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * A repeating-row editor for the two tables that print on the invoice: labour
 * lines and parts.
 *
 * Rows live in React state and are posted as ONE hidden input containing JSON,
 * because FormData cannot encode an array of objects. That keeps the whole form
 * on the existing FormData -> server-action path — the server stays the only
 * validator, and nothing here is trusted.
 *
 * `capacity` is read from the PDF template's coordinates by the caller, never
 * hard-coded, so re-working the template changes the limit on its own.
 */

export interface EditorColumn {
  key: string;
  label: string;
  /** Fraction of the row width, for the grid. */
  span: 1 | 2;
  numeric?: boolean;
  placeholder?: string;
  required?: boolean;
}

export interface EditorRow {
  key: string;
  values: Record<string, string>;
}

function newRow(columns: EditorColumn[], defaults: Record<string, string>): EditorRow {
  return {
    // crypto.randomUUID keeps keys stable without a date/random pair that would
    // collide when two rows are added inside the same millisecond.
    key: crypto.randomUUID(),
    values: Object.fromEntries(columns.map((c) => [c.key, defaults[c.key] ?? ''])),
  };
}

/** What a caller is told after any row changes — never the rows themselves. */
export interface EditorSummary {
  count: number;
  total: number;
}

export function LineEditor({
  name,
  columns,
  initial,
  capacity,
  addLabel,
  emptyLabel,
  rowDefaults = {},
  computeTotal,
  onTotalsChange,
}: {
  /** Hidden input name — the key the server action reads. */
  name: string;
  columns: EditorColumn[];
  initial: Record<string, string>[];
  capacity: number;
  addLabel: string;
  emptyLabel: string;
  rowDefaults?: Record<string, string>;
  /** Reduces the current rows to whatever "total" means for this table. */
  computeTotal?: (rows: Record<string, string>[]) => number;
  /**
   * Fired after every row change with the derived count/total, never the rows
   * themselves.
   *
   * The row state lives entirely here, not mirrored into the parent form —
   * that used to mean every keystroke in a description or part-number field
   * (which affects no total) still re-rendered the whole job form, including
   * unrelated sections. Reporting only two numbers means a caller that stores
   * them in plain state gets React's own bail-out on an unchanged primitive:
   * editing text that doesn't move the total skips the parent's re-render
   * rather than merely shrinking what gets passed up.
   */
  onTotalsChange?: (summary: EditorSummary) => void;
}) {
  const fieldId = useId();
  const [rows, setRows] = useState<EditorRow[]>(() =>
    initial.map((values) => ({
      key: crypto.randomUUID(),
      values: Object.fromEntries(columns.map((c) => [c.key, values[c.key] ?? ''])),
    })),
  );

  function update(next: EditorRow[]) {
    setRows(next);
    const values = next.map((row) => row.values);
    onTotalsChange?.({ count: values.length, total: computeTotal ? computeTotal(values) : 0 });
  }

  // Blank rows are dropped rather than posted: an empty row the owner added and
  // never filled must not become an empty line on a customer's invoice.
  const payload = rows
    .map((row) => row.values)
    .filter((values) => Object.values(values).some((value) => value.trim() !== ''));

  const over = rows.length > capacity;

  function addRow() {
    update([...rows, newRow(columns, rowDefaults)]);
  }

  const addButton = (
    <Button type="button" size="sm" variant="secondary" onClick={addRow}>
      <Plus aria-hidden className="size-4" />
      {addLabel}
    </Button>
  );

  return (
    <div className="flex flex-col gap-3">
      <input type="hidden" name={name} value={JSON.stringify(payload)} />

      <div className="flex items-center justify-between gap-2">
        <p className={cn('text-xs', over ? 'font-medium text-danger' : 'text-muted')}>
          {rows.length} of {capacity} lines
          {over ? ' — more than the invoice template can print' : ''}
        </p>
        {addButton}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted">{emptyLabel}</p>
      ) : (
        rows.map((row, index) => (
          <div
            key={row.key}
            className={cn(
              'rounded-md border p-3',
              index >= capacity ? 'border-danger' : 'border-line',
            )}
          >
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Line {index + 1}</span>
              <Button
                type="button"
                size="sm"
                variant="danger"
                aria-label={`Remove line ${index + 1}`}
                onClick={() => update(rows.filter((r) => r.key !== row.key))}
              >
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {columns.map((column) => (
                <Field
                  key={column.key}
                  label={column.label}
                  htmlFor={`${fieldId}-${column.key}-${row.key}`}
                  className={column.span === 2 ? 'col-span-2' : undefined}
                >
                  <Input
                    id={`${fieldId}-${column.key}-${row.key}`}
                    aria-label={`${column.label} line ${index + 1}`}
                    inputMode={column.numeric ? 'decimal' : undefined}
                    placeholder={column.placeholder}
                    // Client-side backstop for what the server already rejects
                    // (partLineSchema requires a name) — catches it before
                    // submission instead of after a round trip.
                    required={column.required}
                    value={row.values[column.key] ?? ''}
                    onChange={(event) =>
                      update(
                        rows.map((r) =>
                          r.key === row.key
                            ? { ...r, values: { ...r.values, [column.key]: event.target.value } }
                            : r,
                        ),
                      )
                    }
                  />
                </Field>
              ))}
            </div>
          </div>
        ))
      )}

      {/* Same control again, after the last row — filling row 5 and wanting a
          6th used to mean scrolling back to the top to find this button. */}
      {rows.length > 0 ? <div className="flex justify-end">{addButton}</div> : null}
    </div>
  );
}

export const LABOUR_COLUMNS: EditorColumn[] = [
  { key: 'description', label: 'Work done', span: 2, placeholder: 'Front brake discs and pads' },
  { key: 'hours', label: 'Hours', span: 1, numeric: true, placeholder: '2.5' },
];

export const PARTS_COLUMNS: EditorColumn[] = [
  { key: 'partName', label: 'Part name', span: 2, required: true },
  { key: 'partNumber', label: 'Part #', span: 1 },
  { key: 'qty', label: 'Qty', span: 1, numeric: true },
  { key: 'unitPrice', label: 'Unit price (€)', span: 2, numeric: true },
];
