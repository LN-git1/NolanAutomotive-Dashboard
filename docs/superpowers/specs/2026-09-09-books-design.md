# Books: accountant-style bookkeeping top to bottom (no AI)

**Date:** 2026-09-09
**Status:** Approved (design sections 1–5 each confirmed by owner in brainstorming)
**Scope:** Books UI only for v1. No chat box, no model, no data leaves the server. The AI advisor gateway is a future phase and is explicitly out of scope here.

## Problem

Lee can see money collected (Earnings page: cash received from `payments`, month by month) and money owed to suppliers (supplier ledger), but he has no single place showing proper books top to bottom: money in, money out, profit, with drill-down to the individual line. There is also nowhere to record general running costs (rent, ESB, wages, fuel, etc.), so true profit is unknowable in the app today.

## Decisions

1. **Grow Earnings into Books (approach A), with the audit spine of double-entry (essential pieces of B).** Lee never sees debits/credits; the books still cannot be rewritten.
2. **No AI in v1.** Pure deterministic code. Every figure comes from the local database, which also means the AI data-transfer/GDPR leg does not exist yet — nothing to route, minimise, or sign a DPA for.
3. **Compute, never store.** P&L and balances derive from source rows every time, matching the existing convention (`services_subtotal` → `labourSubtotal` mapping, derived paid/owed). Stored copies could only drift.
4. **Append-only corrections.** A wrong expense is fixed with a reversing entry pointing at the original, never an UPDATE/DELETE. The trail survives, the month still reconciles.

## Design

### 1. Architecture / data model

One new `expenses` table: `id`, `expenseDate` (date, not null), `category` (fixed list: rent, wages, utilities, fuel, parts-non-supplier, insurance, phone, other), `amount` (numeric, always positive; sign carried by account type), `note`, optional `receiptStoragePath` (R2, bucket-relative like job attachments — never a public URL), timestamps.

One derived, read-only `ledger_entries` shape (a query, not a second write): the union of payments-in, supplier charges/payments, and expenses, each tagged to a simple account (`Income:Jobs`, `Expense:<Category>`, `Liability:Suppliers`). Every ledger row carries its source ID (payment / supplier-entry / expense ID) so any P&L number drills to the exact document.

Existing `invoices` / `payments` / `supplier_bills` tables are untouched — zero migration risk on live money. Reg plates, customer names and invoice line text stay in the local DB and local UI only (no external leg exists to leak them through).

### 2. Components / UI

One Books page growing out of the existing Earnings route (`app/(dashboard)/earnings` → Books): top P&L cards (In, Out, Profit for the selected month plus year-to-date), then the familiar monthly collapse — each month expands to income lines (invoices paid, tap through to the job), supplier lines, and expense lines. One `Add expense` form built like the job form (big tap targets, category dropdown with Other…, amount, date defaulting to today, note, optional receipt photo) and an expense row that expands to show its receipt plus correct-via-reversal. No accounting vocabulary anywhere — just In, Out, Profit, receipts.

### 3. Data flow

Reads: Books page server-loads monthly P&L aggregates (same two-query shape as today's earnings summary, plus expenses and supplier charges grouped by month) and lazy-loads line detail per expanded month — initial load never pulls row-level data. Writes: Add expense → server action validates (zod: positive amount, real date no later than tomorrow, known category) → inserts the expense row only (the ledger is derived at read time, so there is no second row to write and nothing that can half-write) → revalidates the Books path. Corrections insert a reversal entry referencing the original; both render together. Receipts upload to R2 via signed URL like job attachments, never as base64 in the DB.

### 4. Error handling

Money rules live in the action, not the UI: zero/negative amounts rejected, future dates beyond tomorrow rejected, unknown categories rejected, duplicate submits guarded with an idempotency key so double-taps cannot book twice. Receipt upload failure does not block the entry — it saves, marks the receipt missing, and offers inline retry while keeping typed values. The expense insert is a single-row write and the ledger derives from it, so P&L can never drift from its sources.

### 5. Testing

Pure P&L math (month bucketing, In−Out=Profit, reversal netting) as unit tests on fixed fixtures — no DB needed. One integration test per money path against real Postgres: payment-in lands in income, supplier charge lands in out, expense + reversal net correctly with no double-count. Phone-width check on the Add expense form and month drill-down, matching existing mobile-first QA. No AI and no external API in v1, so no mocks and no flaky network surface.

## Out of scope (future phases)

- AI chat advisor, any model call, any prompt pipeline — needs its own spec covering the pseudonymised gateway, EU/US no-train routing, and the Tier-1 anonymous / Tier-2 pseudonymous rule from the advisor review.
- `GDPR-Requirements.md` canonical doc (written separately to the ZB Automations Business Database).
- VAT returns, payroll runs, bank reconciliation, multi-user roles.

## Success criteria

Lee opens Books and sees this month and year-to-date In, Out, Profit; every figure expands to its individual lines; a new expense (with or without receipt photo) appears in the right month immediately; a corrected expense shows both entries and still reconciles; `pnpm typecheck` and the money tests pass.
