# Roadmap

Things deliberately **not** built yet. Nothing here is broken or missing — each item was raised,
considered, and parked because the garage does not need it to run today.

Ordered by how much value it would add, most first.

---

## 1. Arrival date and due-back-to-customer date

**Status:** designed, not built. Parked 16/08/2026 — not needed to run the garage right now.

### The problem

The job form asks for a **"Due date"**, but that date is actually **the day the car arrives** at the
garage to be worked on. The code already knows this — `lib/db/queries/schedule.ts` opens with *"A job's
`dueDate` is the day it is booked in for"* — so only the **UI label** is wrong.

What is genuinely missing is the date the customer cares about: **when the car goes back to them**. That
can be derived, because the job already carries the total labour hours.

### Decisions already taken (do not re-litigate)

| Question | Decision |
|---|---|
| Working day length | **8 hours, hard-coded.** Explicitly *not* a setting — "don't overcomplicate it". |
| Weekends | **Skipped.** Mon–Fri only. A car arriving Friday with 12h of work is due back **Monday**. |
| Short jobs | **Same day.** A car arriving Monday with 3h of work goes back **Monday**. |
| Schedule display | **Span every working day**, not just the arrival day. |

### The arithmetic

```
workingDays = max(1, ceil(totalLabourHours / 8))
dueBack     = arrivalDate advanced by (workingDays - 1) working days, skipping Sat/Sun
```

The first day counts, which is what makes a 3-hour job same-day. Worked examples:

| Arrives | Hours | Working days | Due back |
|---|---|---|---|
| Mon | 3 | 1 | **Mon** |
| Mon | 12 | 2 | **Tue** |
| Fri | 12 | 2 | **Mon** |
| Thu | 30 | 4 | **Tue** (skips the weekend) |

Edge cases to handle: a job with no labour hours has no due-back date, only an arrival; a car arriving on
a weekend starts counting from the following Monday.

### Why the Schedule change matters most

Today the calendar marks only **arrival** days, so a week holding one long job looks empty — which makes
the "free weekdays" count actively misleading when deciding whether to take on new work. Spanning each
job across the working days it actually occupies is what makes that number truthful.

### Suggested shape

- A pure, unit-testable module (`lib/schedule/dueBack.ts`): `workingDaysForHours`, `addWorkingDays`,
  `calcDueBack`, `spanDates`. All the interesting logic lives here and needs no database.
- **Compute, never store.** Deriving from arrival + hours means it cannot go stale when either changes.
  Storing a `due_back_date` column would need re-computing on every labour edit.
- Rename the Drizzle property `dueDate` → `arrivalDate` while **leaving the `due_date` column alone** —
  same trick used for `services_subtotal` → `labourSubtotal`: correct code, zero migration risk on a
  live table.
- Surfaces to update: job form (label + a live read-only due-back), jobs list, Overview job lists,
  Schedule (spanning + free-day count), and the jobs CSV export.

---

## 2. Job value on the jobs list

Each job now carries its labour and parts, so its value is already known without an invoice. Showing a
total column on the jobs list would let Lee see what is on the floor at a glance.

---

## 3. "Ready to invoice" tile on the Overview

A count and combined value of Completed jobs that have work entered but no invoice yet — money earned
but not yet asked for. Probably the single most useful number for getting paid faster.

---

## 4. Private repository

The repo must stay **public** while the Vercel project is on the Hobby plan: Hobby does not support
collaboration on private repositories, so it blocks any deployment whose commit author is not the Vercel
account owner. See the README's hosting section for the full explanation and how to spot it (it reports
as a *failed build* when nothing was ever built).

Two ways to make it private later, neither urgent:

- author commits from the client's own GitHub identity (the Vercel account owner), or
- move the Vercel project to Pro (~$20/mo, which breaks the €0 hosting requirement).

Nothing secret lives in the repository — every `.env*` is gitignored — so public costs visibility only.

---

## Recurring check, not a feature

**Confirm the daily keep-alive cron has run** — Vercel → project → Cron Jobs. The daily hit on
`/api/health` is the only thing stopping Supabase pausing the free database after ~7 idle days. Worth
confirming once, on or after 22/08/2026.
