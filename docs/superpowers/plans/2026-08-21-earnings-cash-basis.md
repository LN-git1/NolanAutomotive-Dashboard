# Earnings Cash-Basis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Earnings count cash as it arrives from the `payments` table, so a partial payment shows up the moment it is recorded instead of contributing €0 until the job is fully settled.

**Architecture:** `getEarningsSummary` switches its FROM clause from `invoices` to `payments`, dropping the `jobs.status = 'paid'` gate. The 30-day window keys on `payments.paidAt`; the monthly rollup keeps its existing `COALESCE(jobs.dueDate, invoices.issueDate)` attribution. Because that removes the only thing that made a manually-flipped `paid` status count, `changeJobStatus` is made to refuse a bare `paid` transition and the job page forces the real payment flow through a blocking modal.

**Tech Stack:** Next.js 16.3.0 (App Router, `force-dynamic` routes), Drizzle ORM over postgres-js, Postgres (Supabase), Vitest, Tailwind.

## Global Constraints

- **Never run `pnpm build`** — 8GB RAM machine, it locks up. `pnpm typecheck` is the primary verification.
- **Never reset the database.** Accumulating test jobs/invoices on production is explicitly fine.
- All money arithmetic in integer cents via `lib/money.ts`. Drizzle returns `numeric` as JS strings — never multiply them as floats.
- `components/ui/index.tsx` has no `'use client'` by design. Never add a client-only component to that barrel. The modal lives in `components/payments/`, following `components/settings/time-off.tsx`.
- Soft-deleted jobs and voided invoices stay excluded from every money query.
- Tests in `tests/earnings.test.ts` are `describe.skipIf(!TEST_DATABASE_URL)`. Run with `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard`.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/db/queries/earnings.ts` | **Modify.** All three metrics, now payments-based. |
| `components/earnings/earnings-panel.tsx` | **Modify.** Card labels + per-invoice received amounts. |
| `lib/actions/jobs.ts` | **Modify.** `changeJobStatus` refuses bare `paid`; revalidation gaps. |
| `components/payments/payment-form.tsx` | **Create.** Shared full/partial payment UI. |
| `components/payments/mark-paid-button.tsx` | **Modify.** Consumes the shared form. |
| `components/payments/mark-paid-modal.tsx` | **Create.** Blocking modal for the status dropdown. |
| `components/jobs/job-actions.tsx` | **Modify.** Intercepts `paid`, opens the modal. |
| `app/(dashboard)/jobs/[jobId]/page.tsx` | **Modify.** Passes the live invoice to `JobActions`. |
| `lib/actions/danger.ts` | **Modify.** Add `/earnings` to the reset path list. |
| `app/api/invoices/generate/route.ts` | **Modify.** Add the missing `revalidatePath` calls. |
| `tests/earnings.test.ts` | **Modify.** Rewritten for cash-basis semantics. |

---

## Task 1: Earnings queries — cash basis

**Files:**
- Modify: `lib/db/queries/earnings.ts`
- Test: `tests/earnings.test.ts`

**Interfaces:**
- Consumes: `payments`, `invoices`, `jobs` from `lib/db/schema`.
- Produces: `getEarningsSummary(): Promise<EarningsSummary>` — unchanged shape (`allTimeCents`, `last30DayAvgCents`, `months`). `getEarningsMonthInvoices(monthKey): Promise<EarningsMonthInvoice[]>` where `EarningsMonthInvoice` now carries `receivedCents: number` **and** `grandTotal: string` (it previously carried only `grandTotal`).

- [ ] **Step 1: Rewrite the test fixtures to insert payments**

In `tests/earnings.test.ts`, add `payments` to the imported schema tables and to the module-level
`let` declarations, then replace `insertJobAndInvoice` with a version that takes payment amounts:

```ts
async function insertJobAndInvoice(
  id: string,
  invId: string,
  {
    deletedAt = null,
    dueDate = null,
    status = 'paid' as const,
    grandTotal = '200.00',
    paymentAmounts = ['200.00'],
    paidAt = new Date(),
  }: {
    deletedAt?: Date | null;
    dueDate?: string | null;
    status?: 'active' | 'completed' | 'invoiced' | 'paid';
    grandTotal?: string;
    paymentAmounts?: string[];
    paidAt?: Date;
  } = {},
) {
  await db.insert(jobs).values({
    id,
    jobNumber: `TEST-${id.slice(0, 8)}`,
    status,
    customerName: 'Earnings Test',
    vehicleRegistration: 'TEST-REG',
    deletedAt,
    dueDate,
  });

  await db.insert(invoices).values({
    id: invId,
    invoiceNumber: `TEST-INV-${invId.slice(0, 8)}`,
    jobId: id,
    issueDate: ISSUE_DATE,
    labourSubtotal: grandTotal,
    partsSubtotal: '0.00',
    vatRate: '0.00',
    vatAmount: '0.00',
    totalLabour: grandTotal,
    totalParts: '0.00',
    grandTotal,
    parts: [],
    pdfStoragePath: `test/earnings-${invId}.pdf`,
  });

  for (const amount of paymentAmounts) {
    await db.insert(payments).values({ invoiceId: invId, amount, paidAt });
  }
}
```

Import `inArray` alongside `sql` from `drizzle-orm`. Add two new fixture ids alongside the existing ones and insert them in `beforeAll`:

```ts
const partialJobId = randomUUID();
const partialInvoiceId = randomUUID();
const oldDueJobId = randomUUID();
const oldDueInvoiceId = randomUUID();
```

```ts
// A partially-paid job that is NOT `paid` — the exact case that used to count €0.
await insertJobAndInvoice(partialJobId, partialInvoiceId, {
  status: 'invoiced',
  dueDate: DUE_DATE,
  grandTotal: '1000.00',
  paymentAmounts: ['400.00'],
});
// Paid TODAY against a job due 60 days ago: must move the 30-day average.
await insertJobAndInvoice(oldDueJobId, oldDueInvoiceId, {
  status: 'invoiced',
  dueDate: isoDaysAgo(60),
  grandTotal: '500.00',
  paymentAmounts: ['500.00'],
});
```

Add this helper above `describe`:

```ts
function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}
```

Extend `afterAll` to delete payments first (FK order), then invoices, then jobs, including the two
new ids:

```ts
// `inArray` rather than a raw SQL IN list — the ids are UUID strings and
// drizzle parameterises them properly. Payments first: they FK to invoices.
afterAll(async () => {
  const invIds = [invoiceId, deletedInvoiceId, dueDateInvoiceId, partialInvoiceId, oldDueInvoiceId];
  const jobIds = [jobId, deletedJobId, dueDateJobId, partialJobId, oldDueJobId];
  await db.delete(payments).where(inArray(payments.invoiceId, invIds));
  await db.delete(invoices).where(inArray(invoices.id, invIds));
  await db.delete(jobs).where(inArray(jobs.id, jobIds));
});
```

- [ ] **Step 2: Replace the behavioural tests**

Delete `it("does not count an active/invoiced/completed job's invoice")` outright — that rule is
gone. Replace the remaining suite body with:

```ts
it('counts a partial payment on a job that is not yet paid', async () => {
  const summary = await getEarningsSummary();
  const month = summary.months.find((m) => m.key === DUE_DATE_MONTH_KEY);
  expect(month).toBeDefined();
  // €400 of the €1000 invoice, attributed to the job's due-date month.
  expect(month!.totalCents).toBeGreaterThanOrEqual(40_000);

  const detail = await getEarningsMonthInvoices(DUE_DATE_MONTH_KEY);
  const row = detail.find((d) => d.id === partialInvoiceId);
  expect(row).toBeDefined();
  expect(row!.receivedCents).toBe(40_000);
  expect(toCents(row!.grandTotal)).toBe(100_000);
});

it('counts an invoice with no payments as nothing, even when the job is paid', async () => {
  const noPayJobId = randomUUID();
  const noPayInvId = randomUUID();
  await insertJobAndInvoice(noPayJobId, noPayInvId, { paymentAmounts: [] });

  const detail = await getEarningsMonthInvoices(MONTH_KEY);
  expect(detail.some((d) => d.id === noPayInvId)).toBe(false);

  await db.delete(invoices).where(sql`${invoices.id} = ${noPayInvId}`);
  await db.delete(jobs).where(sql`${jobs.id} = ${noPayJobId}`);
});

it('moves the 30-day average for a payment made today against an old job', async () => {
  const summary = await getEarningsSummary();
  // €500 collected today; the divisor is 30. Regardless of other fixtures the
  // average must be at least 500_00/30, which a due-date-keyed window would miss.
  expect(summary.last30DayAvgCents).toBeGreaterThanOrEqual(Math.floor(50_000 / 30));
});

it('sums two instalments against one invoice into a single row', async () => {
  const twoJobId = randomUUID();
  const twoInvId = randomUUID();
  await insertJobAndInvoice(twoJobId, twoInvId, {
    grandTotal: '120.00',
    paymentAmounts: ['30.00', '90.00'],
  });

  const detail = await getEarningsMonthInvoices(MONTH_KEY);
  const rows = detail.filter((d) => d.id === twoInvId);
  expect(rows).toHaveLength(1);
  expect(rows[0]!.receivedCents).toBe(12_000);

  await db.delete(payments).where(sql`${payments.invoiceId} = ${twoInvId}`);
  await db.delete(invoices).where(sql`${invoices.id} = ${twoInvId}`);
  await db.delete(jobs).where(sql`${jobs.id} = ${twoJobId}`);
});

it('does not count a voided invoice', async () => {
  await db
    .update(invoices)
    .set({ voidedAt: new Date(), voidReason: 'test' })
    .where(sql`${invoices.id} = ${invoiceId}`);

  const detail = await getEarningsMonthInvoices(MONTH_KEY);
  expect(detail.some((d) => d.id === invoiceId)).toBe(false);

  await db.update(invoices).set({ voidedAt: null, voidReason: null }).where(sql`${invoices.id} = ${invoiceId}`);
});

it("does not count a soft-deleted job's payments", async () => {
  const detail = await getEarningsMonthInvoices(MONTH_KEY);
  expect(detail.some((d) => d.id === deletedInvoiceId)).toBe(false);
});

it('agrees with itself: the month rollup matches the sum of that month detail', async () => {
  const summary = await getEarningsSummary();
  const month = summary.months.find((m) => m.key === MONTH_KEY);
  expect(month).toBeDefined();

  const detail = await getEarningsMonthInvoices(MONTH_KEY);
  const detailTotal = detail.reduce((sum, d) => sum + d.receivedCents, 0);

  expect(detailTotal).toBe(month!.totalCents);
  expect(detail.length).toBe(month!.invoiceCount);
});
```

Keep the existing `groups by the job's due date` and `falls back to issue date` tests as-is — both
still hold, since the monthly attribution is unchanged.

- [ ] **Step 3: Run the tests to verify they fail**

```bash
pnpm db:migrate
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run tests/earnings.test.ts 2>&1 | tail -30
```

Expected: FAIL. `receivedCents` does not exist on `EarningsMonthInvoice`, and the partial-payment
test finds no row.

- [ ] **Step 4: Rewrite `lib/db/queries/earnings.ts`**

Replace the header comment, `EARNED_INVOICE`, and both query bodies:

```ts
import 'server-only';

import { and, eq, isNull, sql } from 'drizzle-orm';

import { db } from '../index';
import { invoices, jobs, payments } from '../schema';
import { MONTH_NAMES } from './schedule';

/**
 * "Earned" is cash actually received: every `payments` row whose invoice is
 * live and whose job still exists. Deliberately NOT gated on
 * `jobs.status = 'paid'` — a deposit is money in the business's hands the day
 * it lands. Gating on full settlement made a €700 payment against a €1,095
 * invoice contribute nothing, while Overview's "Total outstanding" had already
 * dropped by that same €700, so the money left one side of the ledger and
 * arrived nowhere.
 *
 * Owed + Earned reconciles to the invoiced total PROVIDED every transition to
 * `status = 'paid'` records a payment. Both UI paths do — see `changeJobStatus`,
 * which refuses a bare status flip. Do not add a third path that writes the
 * status directly, or money will go missing here again.
 */
const EARNED_PAYMENT = and(isNull(invoices.voidedAt), isNull(jobs.deletedAt));

/**
 * MONTH attribution: `dueDate` (when the work itself was due), not
 * `invoices.issueDate` (when the paperwork happened to be generated) and not
 * the payment date. A job worked in June, invoiced and paid in August, belongs
 * in June's earnings. `dueDate` is nullable — a job that never had one set
 * falls back to its invoice's `issueDate`, so nothing is silently dropped.
 */
const EARNED_DATE = sql`COALESCE(${jobs.dueDate}, ${invoices.issueDate})`;

/**
 * The TRAILING WINDOW keys on when cash arrived, not on the job's due date — a
 * payment recorded today has to move this number even against an old job, which
 * is the whole point of a rolling average. `- INTERVAL '29 days'` spans exactly
 * 30 calendar days including today, matching the divisor of 30; `'30 days'`
 * would span 31 and quietly understate the average.
 */
const LAST_30_DAYS = sql`${payments.paidAt} >= CURRENT_DATE - INTERVAL '29 days'`;
```

Keep `EarningsMonth`, `EarningsSummary` and `monthLabel` exactly as they are. Replace the body of
`getEarningsSummary`:

```ts
export async function getEarningsSummary(): Promise<EarningsSummary> {
  const [totals, monthRows] = await Promise.all([
    db
      .select({
        allTimeCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
        last30DaysCents: sql<string>`COALESCE(SUM(${payments.amount}) FILTER (WHERE ${LAST_30_DAYS}) * 100, 0)::bigint`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_PAYMENT),
    db
      .select({
        monthKey: sql<string>`to_char(date_trunc('month', ${EARNED_DATE}), 'YYYY-MM')`,
        totalCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
        // DISTINCT because two instalments against one invoice are one invoice,
        // not two — this is what keeps `invoiceCount` equal to the number of
        // rows `getEarningsMonthInvoices` returns for the same month.
        invoiceCount: sql<number>`COUNT(DISTINCT ${invoices.id})::int`,
      })
      .from(payments)
      .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
      .innerJoin(jobs, eq(invoices.jobId, jobs.id))
      .where(EARNED_PAYMENT)
      .groupBy(sql`date_trunc('month', ${EARNED_DATE})`)
      .orderBy(sql`date_trunc('month', ${EARNED_DATE}) DESC`),
  ]);

  const last30DaysCents = Number(totals[0]?.last30DaysCents ?? 0);

  return {
    allTimeCents: Number(totals[0]?.allTimeCents ?? 0),
    last30DayAvgCents: Math.round(last30DaysCents / 30),
    months: monthRows.map((row) => ({
      key: row.monthKey,
      label: monthLabel(row.monthKey),
      totalCents: Number(row.totalCents),
      invoiceCount: row.invoiceCount,
    })),
  };
}
```

Replace the interface and the detail query:

```ts
export interface EarningsMonthInvoice {
  id: string;
  invoiceNumber: string;
  jobId: string;
  jobNumber: string;
  customerName: string;
  /** Cash received against this invoice — what this row contributes to the month. */
  receivedCents: number;
  /** The invoice's full total, so a partial can read "€700 of €1,095". */
  grandTotal: string;
}

/** Fetched only when a month is actually expanded — never on initial page load. */
export async function getEarningsMonthInvoices(monthKey: string): Promise<EarningsMonthInvoice[]> {
  const rows = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      jobId: invoices.jobId,
      jobNumber: jobs.jobNumber,
      customerName: jobs.customerName,
      grandTotal: invoices.grandTotal,
      receivedCents: sql<string>`COALESCE(SUM(${payments.amount}) * 100, 0)::bigint`,
    })
    .from(payments)
    .innerJoin(invoices, eq(payments.invoiceId, invoices.id))
    .innerJoin(jobs, eq(invoices.jobId, jobs.id))
    .where(and(EARNED_PAYMENT, sql`to_char(date_trunc('month', ${EARNED_DATE}), 'YYYY-MM') = ${monthKey}`))
    // Grouping by BOTH primary keys lets Postgres' functional-dependency
    // inference allow `jobs.dueDate` in the ORDER BY below.
    .groupBy(invoices.id, jobs.id)
    .orderBy(EARNED_DATE);

  return rows.map((row) => ({ ...row, receivedCents: Number(row.receivedCents) }));
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run tests/earnings.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: the only errors are in `components/earnings/earnings-panel.tsx`, which still reads
`invoice.grandTotal` as the displayed figure. Task 2 fixes them.

---

## Task 2: Earnings panel — honest labels and received amounts

**Files:**
- Modify: `components/earnings/earnings-panel.tsx`

**Interfaces:**
- Consumes: `EarningsMonthInvoice` from Task 1 (`receivedCents: number`, `grandTotal: string`).

- [ ] **Step 1: Fix the per-invoice row**

In `MonthRow`, replace the amount `<span>` (currently `formatEur(toCents(invoice.grandTotal))`) so a
partial reads honestly:

```tsx
<span className="shrink-0 text-right tabular text-ink">
  {formatEur(invoice.receivedCents)}
  {invoice.receivedCents < toCents(invoice.grandTotal) ? (
    <span className="block text-xs text-muted">of {formatEur(toCents(invoice.grandTotal))}</span>
  ) : null}
</span>
```

- [ ] **Step 2: Fix the card labels**

The "30 day avg." subtitle currently reads `Paid invoices, by issue date` — wrong before this change
(the query used due date) and wrong after. Replace the two `<Card>` bodies:

```tsx
<Card>
  <CardBody>
    <p className="text-xs font-medium text-muted">Earned all time</p>
    <p className="mt-1 text-2xl font-semibold text-ink tabular">
      {formatEur(summary.allTimeCents)}
    </p>
    <p className="mt-1 text-xs text-muted">Cash received</p>
  </CardBody>
</Card>
<Card>
  <CardBody>
    <p className="text-xs font-medium text-muted">30 day avg.</p>
    <p className="mt-1 text-2xl font-semibold text-ink tabular">
      {formatEur(summary.last30DayAvgCents)}
    </p>
    <p className="mt-1 text-xs text-muted">Cash received, last 30 days</p>
  </CardBody>
</Card>
```

- [ ] **Step 3: Label the Monthly card's date basis**

`CardHeader` already accepts a `description` prop. The split basis is deliberate, so say so —
otherwise it reads as an inconsistency:

```tsx
<CardHeader title="Monthly" description="By job due date" />
```

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add lib/db/queries/earnings.ts components/earnings/earnings-panel.tsx tests/earnings.test.ts
git commit -m "fix: Earnings counts cash as it arrives, not only fully-settled jobs"
```

---

## Task 3: Extract the shared payment form

**Files:**
- Create: `components/payments/payment-form.tsx`
- Modify: `components/payments/mark-paid-button.tsx`

**Interfaces:**
- Produces: `PaymentForm({ remainingCents, jobNumber, pending, onSubmit, onCancel, cancelLabel })` where
  `onSubmit: (payment: { payInFull: true } | { amount: string }) => void` and
  `onCancel: () => void`. Pure presentation — it owns the full/partial toggle and the amount box,
  and never calls a server action itself.

- [ ] **Step 1: Create the shared form**

```tsx
'use client';

import { useState } from 'react';

import { Button, Input } from '@/components/ui';
import { formatEur } from '@/lib/money';

/**
 * The full/partial payment choice, extracted from `mark-paid-button.tsx` so the
 * inline Awaiting Payments button and the job page's forced modal cannot drift
 * apart. Presentation only: it reports a chosen payment upward and never talks
 * to a server action, so both callers keep their own pending/error handling.
 */
export function PaymentForm({
  remainingCents,
  jobNumber,
  pending,
  onSubmit,
  onCancel,
  cancelLabel = 'Cancel',
}: {
  remainingCents: number;
  jobNumber: string;
  pending: boolean;
  onSubmit: (payment: { payInFull: true } | { amount: string }) => void;
  onCancel: () => void;
  cancelLabel?: string;
}) {
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState('');

  if (!partial) {
    return (
      <div className="flex flex-col items-stretch gap-1.5">
        <Button size="sm" onClick={() => onSubmit({ payInFull: true })} disabled={pending}>
          {pending ? 'Saving…' : `Paid in full — ${formatEur(remainingCents)}`}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setPartial(true)} disabled={pending}>
          Partial payment
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          {cancelLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-1.5">
      <Input
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(event) => setAmount(event.target.value)}
        className="text-right"
        aria-label={`Amount paid for ${jobNumber}`}
      />
      <div className="flex gap-1.5">
        <Button
          size="sm"
          onClick={() => onSubmit({ amount })}
          disabled={pending || amount.trim() === ''}
        >
          {pending ? 'Saving…' : 'Save'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setPartial(false)} disabled={pending}>
          Back
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `MarkPaidButton` to consume it**

Keep the armed-reveal behaviour and the existing doc comment; replace the two hand-rolled branches
with `<PaymentForm>`. The rendered body becomes:

```tsx
  if (!armed) {
    return (
      <Button size="sm" onClick={() => setArmed(true)}>
        Mark as paid
      </Button>
    );
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <Alert>{error}</Alert> : null}
      <PaymentForm
        remainingCents={remainingCents}
        jobNumber={jobNumber}
        pending={pending}
        onSubmit={submit}
        onCancel={reset}
      />
    </div>
  );
```

Drop the now-unused `partial` / `amount` state and the `Input` / `formatEur` imports from this file;
add `import { PaymentForm } from './payment-form';`.

- [ ] **Step 3: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: zero errors.

- [ ] **Step 4: Verify Awaiting Payments still works**

```bash
pnpm test --run tests/awaiting-payment.test.ts 2>&1 | tail -20
```

Expected: PASS (query-layer test, unaffected — this confirms nothing regressed).

- [ ] **Step 5: Commit**

```bash
git add components/payments/payment-form.tsx components/payments/mark-paid-button.tsx
git commit -m "refactor: extract the shared full/partial PaymentForm"
```

---

## Task 4: Refuse a bare `paid` transition, force the payment modal

**Files:**
- Modify: `lib/actions/jobs.ts:86-103`
- Create: `components/payments/mark-paid-modal.tsx`
- Modify: `components/jobs/job-actions.tsx`
- Modify: `app/(dashboard)/jobs/[jobId]/page.tsx`

**Interfaces:**
- Consumes: `PaymentForm` (Task 3), `recordPayment(invoiceId, payment)` from `lib/actions/payments`.
- Produces: `MarkPaidModal({ invoice, jobNumber, onClose })` where
  `invoice: { id: string; remainingCents: number } | null` — `null` means the job has no live
  invoice, which the modal renders as its "needs an invoice first" state.

- [ ] **Step 1: Make the server refuse it**

In `lib/actions/jobs.ts`, add the guard at the top of `changeJobStatus`, after validation. Replace
the doc comment and the first half of the function:

```ts
/**
 * Move a job to any status EXCEPT `paid`.
 *
 * `paid` is refused here on purpose. Earnings sums the `payments` table, so a
 * status flipped straight to `paid` with no payment behind it would contribute
 * €0 while claiming to be settled — the same money-disappears bug that gating
 * Earnings on `status` caused in the first place. The job page intercepts the
 * status dropdown and forces the real payment flow instead (`MarkPaidModal`),
 * which routes through `recordPayment` and flips the status as a consequence of
 * the money landing, not instead of it.
 */
export async function changeJobStatus(jobId: string, status: string): Promise<ActionResult> {
  await requireSession();

  const parsed = jobStatusChangeSchema.safeParse({ jobId, status });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid status' };

  if (parsed.data.status === 'paid') {
    return {
      ok: false,
      error: 'Record a payment to mark this job paid, so the money is counted in Earnings.',
    };
  }

  // ...unchanged from here: the update and the revalidatePath calls
}
```

- [ ] **Step 2: Create the modal**

```tsx
'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { PaymentForm } from '@/components/payments/payment-form';
import { Alert, Button, LinkButton } from '@/components/ui';
import { recordPayment } from '@/lib/actions/payments';

/**
 * Opened when the job page's status dropdown is set to `paid`. Deliberately a
 * hard stop rather than a hint: `paid` is the one status that means money
 * changed hands, and Earnings now counts the `payments` table, so letting the
 * status be set without recording a payment would make the money invisible.
 *
 * A real modal, built here rather than in `components/ui/index.tsx` — that
 * barrel has no `'use client'` by design, so a shared Modal living there would
 * force every consumer app-wide to become client-side. Same reasoning, and the
 * same shape, as `components/settings/time-off.tsx`.
 *
 * No backdrop-click, no Escape, no X: the only exits are recording a payment or
 * the explicit Cancel, which leaves the status untouched.
 */
export function MarkPaidModal({
  invoice,
  jobNumber,
  onClose,
}: {
  invoice: { id: string; remainingCents: number } | null;
  jobNumber: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(payment: { payInFull: true } | { amount: string }) {
    if (!invoice) return;
    setError(null);
    startTransition(async () => {
      const result = await recordPayment(invoice.id, payment);
      if (!result.ok) {
        setError(result.error ?? 'Could not record the payment.');
        return;
      }
      onClose();
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Record payment for ${jobNumber}`}
        className="w-full max-w-sm rounded-lg border border-line bg-surface p-4 shadow-lg"
      >
        <h2 className="text-sm font-semibold text-ink">Record the payment</h2>

        {invoice ? (
          <>
            <p className="mt-1 text-xs text-muted">
              {jobNumber} is only marked paid once the money is recorded, so it shows up in
              Earnings. A partial payment leaves the job awaiting the balance.
            </p>
            {error ? (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            ) : null}
            <div className="mt-3">
              <PaymentForm
                remainingCents={invoice.remainingCents}
                jobNumber={jobNumber}
                pending={pending}
                onSubmit={submit}
                onCancel={onClose}
                cancelLabel="Cancel — leave status unchanged"
              />
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-xs text-muted">
              {jobNumber} has no invoice yet, so there is no amount to pay against. Generate the
              invoice first, then record the payment.
            </p>
            <div className="mt-3 flex flex-col gap-1.5">
              <LinkButton href="/invoicer" size="sm" className="justify-center">
                Go to Invoicer
              </LinkButton>
              <Button size="sm" variant="ghost" onClick={onClose}>
                Cancel — leave status unchanged
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire it into `JobActions`**

`JobActions` gains two props and intercepts the `paid` option. Replace the component signature,
`handleStatusChange`, and the `<Select>`:

```tsx
export function JobActions({
  jobId,
  jobNumber,
  status,
  liveInvoice,
}: {
  jobId: string;
  jobNumber: string;
  status: JobStatus;
  liveInvoice: { id: string; remainingCents: number } | null;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [payingOpen, setPayingOpen] = useState(false);
  // The <select> is controlled by `status`, so React snaps it back on its own
  // once the modal closes without a status change. Nothing to reset by hand.

  function handleStatusChange(next: string) {
    if (next === status) return;
    setError(null);

    // `paid` never goes through changeJobStatus — the server refuses it. Money
    // has to be recorded, which is what flips the status.
    if (next === 'paid') {
      setPayingOpen(true);
      return;
    }

    startTransition(async () => {
      const result = await changeJobStatus(jobId, next);
      if (!result.ok) {
        setError(result.error ?? 'Could not update the status.');
        return;
      }
      router.refresh();
    });
  }
```

and render the modal at the end of the returned fragment, just before the closing `</div>`:

```tsx
      {payingOpen ? (
        <MarkPaidModal
          invoice={liveInvoice}
          jobNumber={jobNumber}
          onClose={() => setPayingOpen(false)}
        />
      ) : null}
```

Add `import { MarkPaidModal } from '@/components/payments/mark-paid-modal';`.

- [ ] **Step 4: Feed the live invoice from the job page**

In `app/(dashboard)/jobs/[jobId]/page.tsx`, derive the live invoice above the return. The page
already loads `job.invoices` with their `payments` via `getJobWithAttachments`, so this needs no
extra query:

```tsx
  // The one non-voided invoice, with what is still owed on it — the modal needs
  // both. `toCents` because Drizzle hands back `numeric` columns as strings.
  const live = job.invoices.find((invoice) => !invoice.voidedAt);
  const liveInvoice = live
    ? {
        id: live.id,
        remainingCents: Math.max(
          toCents(live.grandTotal) - live.payments.reduce((sum, p) => sum + toCents(p.amount), 0),
          0,
        ),
      }
    : null;
```

Add `import { toCents } from '@/lib/money';` and update the call site:

```tsx
<JobActions
  jobId={job.id}
  jobNumber={job.jobNumber}
  status={job.status}
  liveInvoice={liveInvoice}
/>
```

- [ ] **Step 5: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: zero errors.

- [ ] **Step 6: Commit**

```bash
git add lib/actions/jobs.ts components/payments/mark-paid-modal.tsx components/jobs/job-actions.tsx "app/(dashboard)/jobs/[jobId]/page.tsx"
git commit -m "fix: setting a job to paid now forces the real payment flow"
```

---

## Task 5: Close the revalidation gaps

**Files:**
- Modify: `lib/actions/jobs.ts` (`updateJob`, `softDeleteJob`)
- Modify: `lib/actions/danger.ts:111`
- Modify: `app/api/invoices/generate/route.ts`

- [ ] **Step 1: `updateJob` and `softDeleteJob`**

`updateJob` can change `dueDate`, which moves money between months in the Monthly breakdown;
`softDeleteJob` removes a job's money from every metric. Both revalidate `/` but not `/earnings`.
Add to `updateJob`, after `revalidatePath('/')`:

```ts
  // dueDate is the Monthly breakdown's grouping key — editing it moves money
  // between months.
  revalidatePath('/earnings');
```

and to `softDeleteJob`, after `revalidatePath('/')`:

```ts
  // A deleted job's payments drop out of Earnings and its invoice out of
  // Awaiting Payments.
  revalidatePath('/earnings');
  revalidatePath('/awaiting-payments');
```

- [ ] **Step 2: `factoryReset`**

In `lib/actions/danger.ts`, add `/earnings` to the path list:

```ts
    for (const path of ['/', '/jobs', '/invoicer', '/awaiting-payments', '/earnings', '/suppliers', '/settings']) {
```

- [ ] **Step 3: The generate route**

`app/api/invoices/generate/route.ts` imports nothing from `next/cache`, so issuing or regenerating
an invoice leaves every list stale until a hard reload. Add the import:

```ts
import { revalidatePath } from 'next/cache';
```

and a helper above `POST`:

```ts
/**
 * Issuing or regenerating an invoice changes the jobs list, the Overview and
 * what is owed. NOT `/earnings`: Earnings sums `payments`, a new invoice has
 * none, and regenerating is refused outright once any payment exists.
 */
function revalidateInvoicePaths(jobId: string) {
  revalidatePath('/');
  revalidatePath('/jobs');
  revalidatePath(`/jobs/${jobId}`);
  revalidatePath('/awaiting-payments');
  revalidatePath('/invoicer');
}
```

Call `revalidateInvoicePaths(jobId);` immediately before **both** `return pdfResponse(...)`
statements — the regenerate branch (after the `db.update`) and the new-invoice branch (after the
`uploadBytes` try/catch).

- [ ] **Step 4: Typecheck and full test run**

```bash
pnpm typecheck 2>&1 | tail -20
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run 2>&1 | tail -30
```

Expected: zero type errors, all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/actions/jobs.ts lib/actions/danger.ts app/api/invoices/generate/route.ts
git commit -m "fix: revalidate /earnings and the invoice routes after mutations"
```

---

## Task 6: End-to-end verification

**Files:** none — verification only.

- [ ] **Step 1: Confirm the production numbers**

Re-run the read-only diagnostic that found the bug (node with `--env-file=.env.production.local`,
`SELECT` only, never a write). Confirm against the live data:

| Metric | Before | Expected after |
|---|---|---|
| Earned all time | €0.00 | **€700.00** |
| 30 day avg | €0.00 | **€23.33** |
| Monthly | "No earnings recorded yet." | **August 2026 — €700.00** |

€700 and not €880: J-0013 (€120) and J-0014 (€60) are collected but their jobs are soft-deleted,
and that exclusion is deliberate.

- [ ] **Step 2: Browser-confirm against the running app**

Start the dev server against production data, drive it with `claude-chrome`
(`chromium.connectOverCDP('http://localhost:9222')` — never `launch()`), screenshot, and read the
screenshots back. Check:

1. `/earnings` — all three figures match Step 1.
2. Expand **August 2026** — shows `J-0020 — €700.00` with `of €1,095.00` beneath it.
3. A job page → set Status to `paid` → the modal appears and cannot be dismissed by clicking the
   backdrop or pressing Escape.
4. "Cancel — leave status unchanged" closes it and the dropdown snaps back to the original status.
5. On a job with no live invoice, the modal shows the "needs an invoice first" state with the
   Invoicer button.

- [ ] **Step 3: The reported symptom, end to end**

On the running app, record the remaining €395 against J-0020 through the modal. Without a hard
reload, confirm Earned all time reads **€1,095.00**, the 30-day avg moves to **€36.50**, and August
reads **€1,095.00**. Then confirm the job's status is now `paid` and it has left Awaiting Payments.

- [ ] **Step 4: Changelog**

Fresh timestamp — never reuse one:

```bash
TZ=Europe/Dublin date "+%d/%m/%Y @ %H:%M:%S IST"
```

Add the entry at **line 2** of `CHANGELOG.md`, directly after `# Changelog`, pushing all existing
entries down. It must open with `**Project completion: xx.xx%**` derived from a real count, and
must cover Goal, Fixed/Added/Changed (with cause, fix and verification for each), and Files Touched
— explaining *why* each change was made, not just what changed. Confirm the model string with the
user before committing.

- [ ] **Step 5: Commit and push**

```bash
git add -A && git status --short
git commit -m "docs: record the Earnings cash-basis fix and the forced payment modal"
git push origin main
git log --oneline -3
```

Confirm the working tree is clean afterwards, including untracked files.
