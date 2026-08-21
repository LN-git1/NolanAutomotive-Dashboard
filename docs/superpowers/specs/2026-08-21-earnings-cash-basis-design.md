# Earnings: count cash as it arrives

**Date:** 2026-08-21
**Status:** Approved

## Problem

All three Earnings figures — **Earned all time**, **30 day avg**, and **Monthly** — read
€0.00 / €0.00 / "No earnings recorded yet." on production, while €700 of real cash sits in the
`payments` table. Verified by read-only query against production on 2026-08-21:

| Job | Invoice | Received | Job status | Counted? |
|---|---|---|---|---|
| J-0020 | €1,095.00 | **€700.00** (recorded 16:35 UTC that day) | `invoiced` | no — €0 |
| J-0013 | €120.00 | €120.00 (€30 + €90) | `paid` | no — job soft-deleted |
| J-0014 | €60.00 | €60.00 | `paid` | no — job soft-deleted |

There are zero non-deleted jobs with `status = 'paid'` in production, so every earnings query
returns nothing.

### Root cause

`lib/db/queries/earnings.ts` gates on `jobs.status = 'paid'` and sums the invoice's full
`grandTotal`. It never reads `payments`. A partially-paid invoice therefore contributes €0 no
matter how much cash has landed.

This is a regression from the partial-payments feature (`a95fdc3`). That commit taught
`getOutstandingInvoiceTotalCents` to net payments out of "Owed" but left `getEarningsSummary` on
the old status gate. J-0020's €700 left "Total outstanding" and arrived nowhere — the two halves
of the ledger no longer reconcile.

## Decisions

Both existing behaviours were deliberate choices recorded in the `nolan-product-decisions` memory,
so they were re-confirmed with the owner rather than reversed.

1. **Earnings counts cash as it arrives**, from `payments` — superseding the 2026-08-17
   "gated on full settlement" rule.
2. **Split date basis**, preserving the 2026-08-17 due-date fix where it actually applied:
   - **Monthly** stays on `COALESCE(jobs.dueDate, invoices.issueDate)` — the month the *work was
     due*. This is what the original complaint (June/July jobs landing in August) was about.
   - **30 day avg** moves to `payments.paidAt` — when cash actually arrived. Keyed on due date it
     would still not move when a payment is recorded against an older job, i.e. the reported
     symptom would survive the fix.
3. **Setting Status to `paid` opens a blocking modal** that forces the real payment flow.
4. **No invoice yet → require an invoice first**, with a route through to the Invoicer. Money only
   ever exists against an invoice (`payments.invoiceId` is NOT NULL).
5. **One explicit "Cancel — leave status unchanged"**; no backdrop click, Escape, or X.

## Design

### Earnings queries

Select from `payments`, joining out to `invoices` and `jobs`:

```
FROM payments
  JOIN invoices ON invoices.id = payments.invoice_id
  JOIN jobs     ON jobs.id     = invoices.job_id
WHERE invoices.voided_at IS NULL AND jobs.deleted_at IS NULL
```

| Metric | Sums | Dated by |
|---|---|---|
| Earned all time | `SUM(payments.amount)` | — |
| 30 day avg | same, `FILTER (WHERE paid_at >= CURRENT_DATE - INTERVAL '29 days')` ÷ 30 | `payments.paidAt` |
| Monthly | same, grouped | `COALESCE(jobs.dueDate, invoices.issueDate)` |

- `29 days` spans exactly 30 calendar days including today, matching the divisor of 30. The
  current `30 days` spans 31.
- `invoiceCount` becomes `COUNT(DISTINCT invoices.id)` — J-0013's two instalments would otherwise
  count as two invoices and break the rollup-vs-detail invariant.
- The month drill-down returns **received per invoice** plus the invoice total, rendered as
  "J-0020 — €700.00 of €1,095.00". Returning `grandTotal` alone would no longer sum to the header.

### Forced payment modal

Setting Status to `paid` no longer writes a status; it opens a blocking modal.

**Client** — `JobActions` intercepts `onChange` when the target is `paid`. Three states:

- Live invoice with a balance → full-payment button (showing the remaining) or partial + amount box.
- No live invoice → "needs an invoice first", with a button through to the Invoicer.
- Either way, one explicit "Cancel — leave status unchanged" reverting the dropdown.

**Server** — `changeJobStatus` refuses a bare transition to `paid`. The modal is the UX; this is
what makes the invariant hold against a stale client or a future caller. Every other transition is
untouched.

**Structure** — `MarkPaidButton`'s inner payment UI is extracted to a shared
`components/payments/payment-form.tsx` consumed by both the inline button and the modal, so the
two cannot drift. The modal lives in `components/payments/`, following `components/settings/time-off.tsx`
— outside the `components/ui` barrel, which has no `'use client'` by design.

Recording a **partial** leaves the job unsettled, so it lands back on `invoiced`, with an inline
note explaining why rather than silently contradicting the dropdown.

### Revalidation

`softDeleteJob` and `updateJob` revalidate `/` but not `/earnings`; `factoryReset` omits
`/earnings`; `/api/invoices/generate` imports nothing from `next/cache`. Secondary — real
staleness, not the cause of the €0.

## Expected behaviour that will look like a bug

**Monthly will routinely show a future month at the top.** It buckets by job due date and orders
newest-first, so a deposit taken today on a job due next month lands in September as the first row,
in August. Under the old code a future-dated job had to be fully `paid` to appear at all; now any
deposit does it — and deposit-now-balance-later is exactly what `payments` was built for. J-0001
(due 2026-08-27) is a live future-dated job already in production.

## Out of scope

- **Soft-deleted jobs stay excluded.** Post-fix "Earned all time" reads **€700, not €880** —
  J-0013 and J-0014 are collected but deleted. 18 of 24 production jobs are soft-deleted test data;
  deleting a job is how test money gets removed.
- **Timezone.** Production runs UTC with no timezone handling anywhere in the codebase. A payment
  after 23:00 IST lands on the previous UTC day — a ±1 day edge on the 30-day window only, since
  Monthly uses `dueDate`, a plain `date`.

## Success criteria

On today's production data:

| Metric | Before | After |
|---|---|---|
| Earned all time | €0.00 | **€700.00** |
| 30 day avg | €0.00 | **€23.33** |
| Monthly | "No earnings recorded yet." | **August 2026 — €700.00** |

Expanding August shows **J-0020 — €700.00 of €1,095.00**.
