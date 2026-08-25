# Changelog

## 25/08/2026 @ 18:40:48 IST — "claude-opus-5"

**Project completion: 100.00%**

Basis: an adversarial multi-lens review of the prior entry's derivation change (5 independent
review passes over status-coupling, SQL correctness, UI correctness, write paths and test gaps,
each finding cross-examined by a separate skeptical pass told to default to refuting it) surfaced
one HIGH-severity data-correctness defect and four smaller real ones; all five are fixed and
verified — the HIGH one caught by a failing regression test written from the claim, confirmed
failing before the fix, confirmed passing after. Typecheck clean, eslint clean on every touched
file, 192 tests passing (was 189), including 9 DB-backed against real Postgres (was 7).

### Fixed — a EUR 0.00 invoice was classified as settled income

The review's most serious finding, surfaced independently by two of the five lenses: `INVOICE_IS_
SETTLED` in `lib/db/queries/invoice-state.ts` (see the 02:00:58 entry above) was defined as `NOT
INVOICE_HAS_BALANCE`, which is true for an invoice totalling EUR 0.00 with zero payments against
it — nobody owes anything on a blank invoice, so "not owed" was read as "paid in full". A job
invoiced before any work, rate or parts were entered would be counted as settled, filed under Paid
jobs, counted on the Overview's Paid tile, and vanish from Jobs — inventing income the business
never actually earned.

Reachable, not theoretical: `buildInvoice` (`lib/invoices/build.ts`) only guards that the job
exists and that its line counts fit the template. The existing empty-invoice guard in
`/api/invoices/generate` covered ONLY the regenerate branch (replacing a real invoice with a blank
one) — a first-ever invoice on an empty job had no equivalent check and would issue at EUR 0.00
without complaint.

**Fixed two ways, deliberately overlapping:**
1. `INVOICE_IS_SETTLED` now requires `grandTotal > 0 AND NOT INVOICE_HAS_BALANCE` — a zero-total
   invoice can never read as settled, regardless of how it got created.
2. `/api/invoices/generate` now refuses to ISSUE a EUR 0.00 invoice (the guard the regenerate
   branch already had, extended to the new-invoice branch it was missing from) — the owner fills
   in the job first, same as regenerate has always demanded.

While fixing this, `JOB_IS_PRE_INVOICE` (used by the Overview's Active tile, `/jobs`'s open scope,
and Schedule's liveness filters) was rewritten from "has no live invoice" to "neither settled nor
awaiting payment" — a genuine complement of the other two buckets rather than a third, separately-
derived condition that could disagree with them. Written the old way, a job whose invoice was
neither settled nor owing (the exact zero-total shape above) would have appeared in NO Overview
tile and NEITHER job list — lost outright, which is worse than being mislabelled.

**Regression test** (`tests/awaiting-payment.test.ts`): inserts a job with a EUR 0.00 invoice and
no payments, asserts it is never counted as settled and always appears in the open job list, and
asserts the three pipeline buckets still sum to the live job count. Written from the review
finding and confirmed failing against the pre-fix code before the fix was applied.

### Fixed — `createJob` accepted a client-supplied `status`, bypassing every guard

`createJob` parsed the create form with the full `jobInputSchema`, same shape as the `updateJob`
bug the prior entry closed — except the create *form* never renders a status control at all, so
this was reachable only by calling the Server Action directly with a crafted `status` key, not
through the browser UI. Renamed `jobUpdateSchema` to `jobContentSchema` (`jobInputSchema.omit({
status: true })`) and moved BOTH `createJob` and `updateJob` onto it, so status can never enter a
job through either content path — the jobs table's own `default('active')` decides a new job's
status, which is what it should be regardless.

### Fixed — the status dropdown showed the raw word, contradicting the badge beside it

`JobActions`' status `<select>` rendered `{value}` straight from `JOB_STATUSES` instead of routing
through `JOB_STATUS_LABELS`, so a job's own actions panel showed the literal `completed` in its
dropdown while the badge two lines above it (fixed in the prior entry) already read "Work done" —
the exact inconsistency that entry existed to remove, reintroduced in the one control the owner
actually uses to change status.

### Fixed — recording a payment on an already-settled job was an unrecoverable-looking dead end

`changeJobStatus` guards SETTING a job to `paid`, but not moving it AWAY from `paid` afterward — an
owner can pick `active`/`completed`/`invoiced` on a job that has already been paid in full (perhaps
by mistake, perhaps meaning "more work is needed"). Reopening the status dropdown and picking Paid
again then opened `MarkPaidModal` against that same, already-settled invoice: `PaymentForm` offered
a "Paid in full — EUR 0.00" button, and clicking it called `applyPayment` with an amount of zero,
which is refused outright ("Enter an amount greater than zero.") — a confusing validation error for
a job that in fact needed no action at all. `MarkPaidModal` now detects `remainingCents <= 0` and
shows "already paid in full, nothing to record" instead of a broken payment form.

### Test coverage added

Two gaps the review named directly, both closed with DB-backed assertions in
`tests/awaiting-payment.test.ts`:
- `listJobsInPipeline`'s two Overview list cards now have their own test, asserting they agree in
  both length and disjointness with the `countJobPipeline` counts driving the tiles above them —
  the tiles and their lists could previously drift apart exactly as they did before the whole fix.
- `listSettledJobs`'s ordering (`LAST_PAYMENT_AT DESC NULLS LAST`) is now asserted against two
  jobs settled a year apart.

### Findings reviewed and deliberately not acted on

The same review raised several claims that did not survive independent adversarial verification —
recorded here rather than silently dropped, per the review's own no-silent-truncation rule:
- **`countJobsPerDay`'s status migration**: real code, but the function has no caller anywhere in
  the app (confirmed by repo-wide grep) — it was already dead before the prior entry touched it.
- **`listScheduledJobs` still counts settled work as calendar load**: true, but pre-dates this
  change entirely (`git log` shows the function's date-range filter is unchanged since its
  creation) — a legitimate future improvement, not a regression from anything shipped here.
- **`/paid-jobs`'s uncapped-count-beside-capped-list shape**: the same shape already exists on
  `/jobs` itself (its header count is real-time while its search-term hint is a separate query),
  and the settled-invoice cap (500) is not reachable at this business's current scale (production
  holds one settled job).
- **No test exercises `updateJob`'s actual database write, only `jobContentSchema`'s shape**:
  accurate, and worth doing, but out of scope for this pass — the schema-shape assertion is the
  one that fails on the exact code change (reintroducing `status` into the parse or the `.set()`)
  that caused the original production bug; a DB-backed behavioural test is a reasonable follow-up,
  not a defect in what shipped today.

### Files touched

- `lib/db/queries/invoice-state.ts` — `INVOICE_IS_SETTLED` requires a nonzero total;
  `JOB_IS_PRE_INVOICE` redefined as the complement of the other two buckets.
- `app/api/invoices/generate/route.ts` — refuses to ISSUE a EUR 0.00 invoice.
- `lib/validation/job.ts` — `jobUpdateSchema` renamed `jobContentSchema`; doc comment covers both
  `createJob` and `updateJob`.
- `lib/actions/jobs.ts` — `createJob` moved onto `jobContentSchema`.
- `components/jobs/job-actions.tsx` — status `<select>` options render `JOB_STATUS_LABELS`.
- `components/payments/mark-paid-modal.tsx` — an already-settled invoice shows a plain "nothing to
  record" message instead of a EUR 0.00 payment button that could only fail.
- `tests/awaiting-payment.test.ts` — zero-total regression test, pipeline-list agreement test,
  settled-jobs ordering test.
- `tests/job-status-guard.test.ts` — updated for the `jobContentSchema` rename.

## 25/08/2026 @ 02:00:58 IST — "claude-opus-5"

**Project completion: 100.00%**

Basis: 7 of 7 items Lee raised in this round are shipped and verified — (1) Jobs listing settled work,
(2) no Paid jobs page, (3) settled jobs not moving there automatically, (4) Overview reporting "Paid: 0"
falsely, (5) four contradictory job tiles instead of three, (6) J-0019 still badged as a completed job,
and (7) J-0019 stuck in Awaiting payments at €0.00 owed. Verified against live production data before
and after, against a real Postgres for the query layer (7 DB-backed tests), and in a browser at both
1440px and 390px. Typecheck clean, 159 tests passing, eslint clean on every touched file.

### Fixed — a job could be paid in full and the whole app would still say it wasn't

Lee reported that J-0019 had been invoiced (NA-2026-0017, €450.00), paid in full, and yet still showed
as a completed job, still sat in the jobs list, and still sat in Awaiting payments showing €0.00
remaining without ever dropping off it. Meanwhile the Overview claimed zero paid jobs.

**Cause — two separate defects that compounded.**

*The write.* `updateJob` parsed the job form with the full `jobInputSchema` and spread the result
straight into the UPDATE, so the form's own status `<select>` was written on **every save**. That select
was uncontrolled (`defaultValue`), so it held whatever value the page had been *rendered* with, not the
job's current one. Recording a payment flipped the job to `paid`; the next save on that page silently
put it back. `changeJobStatus` has guarded `paid` since it was written — but `updateJob` was a second,
unguarded door into the same column, exactly the "third path that writes the status directly" that
`lib/db/queries/earnings.ts` warns against in its own docstring. Confirmed against production: J-0019
sat at `completed` with €450.00 of €450.00 paid, and J-0020 at `completed` with €700.00 of €1,095.00.

*The read.* Every money question was then answered from that column. `listAwaitingPayment` and
`getOutstandingInvoiceTotalCents` filtered `status <> 'paid'`, and the Overview counts grouped by
status. So a settled job whose status had drifted stayed on the owed list **forever**, showing €0.00 —
which is precisely what Lee saw. The list was rendering a corrupted column faithfully.

**Fix — derive the money from the money.** New `lib/db/queries/invoice-state.ts` holds one definition
each of "still owed", "settled" and "not billed yet", all computed from a live (non-voided) invoice and
the payments recorded against it. Awaiting payments, the outstanding total, the Overview counts, both
Overview lists, the jobs list and the new Paid jobs page all import those same predicates instead of
rolling their own SQL — this codebase has already been bitten once by the Awaiting payments header and
its rows computing "owed" separately, and six hand-rolled copies would have been that bug waiting to
come back in a new shape.

This makes the behaviour **self-healing**: however `jobs.status` drifts, a fully paid job leaves
Awaiting payments and appears under Paid jobs, because the payments say so. `jobs.status` is now the
workflow badge and nothing more.

**And the door is closed.** `jobUpdateSchema` (`jobInputSchema.omit({ status: true })`) means editing a
job structurally cannot rewrite its status. Omitting the key is the fix rather than just deleting the
form field: `jobInputSchema.status` defaults to `'active'`, so removing the input alone would have made
every save stamp `active` over whatever stage the job had reached — strictly worse than the original
bug. The duplicate Status control is gone from the job form (`JobActions`, a live control on the same
screen, already owned it); a new job is `active`, which is what the schema has always said it should be.

**Data corrected.** Migration `0007_reconcile_job_status_with_payments.sql` moves a job forward to the
stage its own invoice has already reached — never backward, so a status set deliberately for work still
in hand is untouched. Applied to production after a read-only dry run confirmed it would touch exactly
two rows and no others: J-0019 `completed` → `paid`, J-0020 `completed` → `invoiced`. Idempotent.
Note this repo has **no automatic migration step on deploy** (`vercel.json` carries only the health
cron), so `pnpm db:migrate:prod` was run by hand — a future data migration needs the same.

### Added — a Paid jobs page, so Jobs is the work still in front of you

Lee's actual complaint underneath the bug: `/jobs` listed every job ever created, so the cars in the
workshop and the invoices still owed were buried under work settled months ago.

`/jobs` now lists **open work only** — not billed yet, or billed and still owed. `/paid-jobs` is the
other half: invoiced and settled in full, with the invoice number, the date of the final payment, a
total collected banner, and its own search. Membership is decided by the payments, so a job lands there
the moment its invoice is settled and cannot be argued out of it by a status label.

It sits in the sidebar and the mobile drawer, deliberately **not** in the phone bottom bar — it is a
lookup ("what did we charge them in March?"), not somewhere the owner works from, and there is no sixth
slot that wouldn't crush the other five.

Searching `/jobs` for a customer who paid last month would now come back empty and read as "we lost the
job", so settled matches are counted rather than hidden: the page shows "N paid jobs are filed under
Paid jobs" with a link that carries the search term across. Shown with no search too, so the new page is
discoverable from the list it was carved out of.

### Changed — three Overview tiles that agree with each other, and with the pages they link to

There were four, split by `jobs.status`, and they contradicted each other: "Completed jobs: 2 — ready to
invoice" sat beside "Paid: 0" while both of those jobs had in fact been invoiced and one had been paid
in full. Now **Active / Invoiced / Paid**, counted from the same predicates as the lists behind them,
partitioning every live job exactly once so they sum to the total. Each links where it belongs —
`/jobs`, `/awaiting-payments`, `/paid-jobs` (the old "Paid" tile pointed at `/jobs?status=paid`, a
filter that would now always be empty; `paid` is gone from that dropdown for the same reason).

The second Overview list changed with them: "Completed jobs — ready to invoice" listed jobs by status
and so showed work already invoiced and paid. It is now "Awaiting payment", mirroring the tile above it.
And the Recently invoiced table's Status column now reflects the **invoice's** payment state rather than
the job's workflow label, which is what a column in a table of invoices reads as.

### Changed — `completed` no longer looks like `paid`

Half of why "Completed jobs: 2" read as "two jobs are done and paid for" is that the badge wore the same
green as `paid` while meaning something entirely different. `completed` now displays as **"Work done"**
on a neutral badge; the enum value is untouched, because that is what the CSV export writes and that
column is machine-readable. Labels live in one map (`JOB_STATUS_LABELS`) so the badge and the filter
dropdown cannot drift apart.

### Tests

`tests/awaiting-payment.test.ts` was keyed on the old `status <> 'paid'` predicate and one of its cases
asserted the exact behaviour that caused this bug — that flipping status to `paid` removes a job from
the owed list. That case is **inverted**: a status label with no money behind it must not be able to
write off a real debt. Added the J-0019 regression directly (paid in full with a stale `completed`
status → leaves Awaiting payments, appears under Paid jobs, moves between the two job lists), a partial
payment case, and a pipeline-count case. Seven DB-backed tests, run against real Postgres — a mock
cannot show that a correlated subquery behaves this way. Plus a no-database assertion that
`jobUpdateSchema` cannot carry a status, which is the fix stated as a test.

### Changed — Schedule reads liveness the same way

`listUnscheduledJobs` and `countJobsPerDay` were the last surfaces keying "is this job still live" off
`jobs.status` (`<> 'paid'`, `<> 'invoiced'`). They now use the shared predicates too. Same intent, same
result on current data — but leaving one surface reading the column that drifts is how the bug comes
back wearing a different hat.

### Changed — the Jobs list shows its own split

The Overview's Active tile counts work not billed yet (4 in production) and links to `/jobs`, which
lists open work — including invoiced-but-unpaid (6). Both correct, but a 4 → 6 jump on one click is a
smaller version of the contradiction being fixed here. The unfiltered list header now reads "6 open
jobs — 4 in the workshop, 2 awaiting payment", so the tile's figure is visible where it lands. Skipped
once a search or status filter is on, where the breakdown would count jobs the list is not showing.

### Files touched

- `lib/db/queries/invoice-state.ts` — **new.** The single definition of owed / settled / not billed yet.
- `lib/db/queries/jobs.ts` — awaiting payments keyed on the balance; `listSettledJobs`,
  `countSettledJobs`, `countJobPipeline`, `listJobsInPipeline`, `scope` on `listJobs`.
- `lib/db/queries/overview.ts` — outstanding total shares the predicate; recent invoices carry their own
  remaining balance.
- `lib/validation/job.ts` — `jobUpdateSchema`, `JOB_STATUS_LABELS`, `JOB_PRIORITY_LABELS`.
- `lib/actions/jobs.ts` — `updateJob` can no longer write a status; `/paid-jobs` revalidation.
- `lib/actions/payments.ts`, `app/api/invoices/generate/route.ts`,
  `app/api/invoices/[id]/void/route.ts` — revalidate `/paid-jobs`.
- `app/(dashboard)/paid-jobs/page.tsx`, `app/(dashboard)/paid-jobs/loading.tsx` — **new.**
- `lib/db/queries/schedule.ts` — unscheduled/per-day counts off `jobs.status`.
- `app/(dashboard)/jobs/page.tsx` — open scope, `paid` off the filter, the settled-matches hint, the
  workshop/awaiting split in the header.
- `app/(dashboard)/page.tsx`, `app/(dashboard)/loading.tsx` — three tiles, matching skeleton.
- `components/jobs/job-form.tsx` — the duplicate Status control removed.
- `components/ui/index.tsx` — badge labels; `completed` off the `paid` green.
- `components/layout/sidebar.tsx` — Paid jobs nav item.
- `drizzle/migrations/0007_reconcile_job_status_with_payments.sql` + journal — **new.**
- `tests/awaiting-payment.test.ts`, `tests/job-status-guard.test.ts` — see above.
- `ROADMAP.md` — item 3 re-worded for the new tile vocabulary.
- `README.md` — `/paid-jobs` in the route inventory; `invoice-state.ts` added to the conventions.

## 22/08/2026 @ 01:59:38 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 1 of 1 follow-up request shipped — Schedule now opens straight onto today's readable detail
instead of a scroll-past-the-grid agenda or unreadable chips. Verified against a live-viewport
(non-scrolled) mobile screenshot showing the fix actually works, not just a full-page capture that
would have hidden a below-the-fold regression. Typecheck, lint, and the 158-test suite are clean.

### Changed — Schedule opens on today's full detail, above the grid, not below it

Two rounds in, the mobile calendar still wasn't answering the actual question: "what am I doing
today, right now, without tapping anything." The previous entry made grid cells show real (if tiny)
chips instead of a bare count, but the readable detail panel sat *below* six weeks of grid — on a
phone that grid alone fills the viewport, so the panel that actually answers the question required
scrolling past it first. And with no day explicitly tapped, that panel defaulted to a generic
"what's coming up" agenda rather than today specifically.

**Fix.** Two changes, both in `app/(dashboard)/schedule/page.tsx`:

1. **Default selection is today**, not "nothing." `selectedDate` now falls back to today whenever
   today is actually in the month being viewed (`isViewingCurrentMonth`), so opening `/schedule`
   plain lands on today's jobs — time, job number, customer, vehicle make/model, and the work list —
   with zero taps. Browsing a different month, or explicitly asking via the new `?agenda=1` param
   (what the "← What's coming up" link now sets), still falls back to the multi-day agenda; that
   capability isn't gone, just no longer the default when there's an obvious better one.

2. **The detail panel moved above the grid**, not below it. It's now the first thing inside the
   Card, right under the month-nav header — visible in the initial viewport on a phone without any
   scrolling. The grid moved below it, unchanged otherwise, still available for jumping to a
   specific day or eyeballing the month's shape.

Grid chips are unchanged from the last entry (still real text, still tiny on a phone — that
limitation is inherent to seven columns at phone width, same as Google Calendar's own month view).
The actual fix for "unreadable" was never going to be shrinking chip text further; it was making the
thing that's genuinely readable — the detail panel — the first thing you see.

### Files Touched

- `app/(dashboard)/schedule/page.tsx` — default-to-today selection with `isViewingCurrentMonth`
  and `forceAgenda`/`?agenda=1`; detail panel and grid swapped order within the Card.

## 22/08/2026 @ 01:53:08 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 1 of 1 follow-up request shipped — mobile grid cells show real job chips instead of a bare
count. Verified with a fresh mobile-viewport screenshot against the local dev data seeded in the
previous entry. Typecheck, lint, and the 158-test suite are clean.

### Changed — mobile calendar cells show actual job chips, not just a count badge

The previous entry's mobile grid showed only the day number and a small coloured count ("2", "1")
per cell — the chips themselves were `hidden` below the `md` breakpoint because a phone-width column
seemed too narrow for them. Feedback (with a Google Calendar mobile screenshot as reference): that's
not enough — the cell itself should show what's actually booked, truncated, the same way Google
Calendar's own month view shows a truncated title chip per day, not just a number.

**Fix.** `JobChip` now renders at every width. Since a phone column has room for roughly one chip
and a desktop column has room for three, each cell shows a tier-appropriate slice — 1 chip below
`sm`, 2 from `sm`, 3 from `md` — by rendering all three candidate chips and hiding index 1 and 2
behind `sm:block`/`md:block`, rather than slicing the array in JS (which can't be responsive). The
"+N more" overflow line is likewise computed for each tier and hidden outside it, so a day with 2
jobs shows "+1 more" on a phone but the full second chip from `sm` up, where it fits.

The top-corner count badge (redundant now that the actual chip is visible) was removed, along with
the `workload()`-derived `load` variable that only fed it — `workload()` itself is untouched, still
used by the day-detail panel and the agenda fallback below the grid.

Cell minimum heights went from `min-h-16 sm:min-h-20 md:min-h-28` to `min-h-20 sm:min-h-24 md:min-h-28`
to give the now-visible chip room without the day number and "+more" line crowding it.

### Files Touched

- `app/(dashboard)/schedule/page.tsx` — chip visibility made responsive per tier instead of
  hidden below `md`; count badge and its `load` variable removed; cell min-heights bumped.

## 22/08/2026 @ 01:31:25 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 2 of 2 requested changes shipped — Overview's stat tiles as real links, and the Schedule
calendar's mobile grid with per-job vehicle/work detail. Both verified end-to-end in a real browser
(login, live grid interaction, mobile viewport, chip-click target confirmed via computed styles and
`elementFromPoint`), not just by reading the diff. Typecheck, lint, and the 158-test suite are clean.

### Added — Overview's stat tiles are now links into the section they summarise

The six tiles at the top of Overview (Active jobs, Completed jobs, Invoiced, Paid, Total
outstanding, Total owed to suppliers) were plain `<Card>`s — inert, despite each one being a filtered
view that already exists elsewhere in the app. A user glancing at "12 completed jobs" had no way to
get to that list except navigating to Jobs and setting the filter by hand.

**Fix.** `Kpi` (`app/(dashboard)/page.tsx`) now renders as a `<Link>` styled identically to the old
card, with a hover/focus affordance so it reads as interactive. Routes chosen to match existing
semantics rather than inventing new ones: Active/Completed/Paid go to `/jobs?status=<status>` (a
filter the Jobs page already supports); Invoiced and Total outstanding both go to
`/awaiting-payments`, since that page's own "Total outstanding" figure is the same number by a
different name; Total owed to suppliers goes to `/suppliers`, whose own total is likewise the same
figure restated.

### Added — Schedule's month grid now renders on mobile, with make/model and work items per job

The calendar previously split into two unrelated views at the `md` breakpoint: a full seven-column
grid on desktop, and a flat agenda list on mobile that only showed job number, customer, and
registration — no vehicle make/model, no work items, and no grid at all. A user on a phone (~90% of
this app's real usage, per `job-form.tsx`'s own comment) could never see the actual calendar shape of
their month, only a flat list.

**Fix.** The grid (`app/(dashboard)/schedule/page.tsx`) is now unconditional at every width — chips
still render inline from `md` up, and below that each cell shows just the day number and a job-count
badge, since a phone-width column has no room for chip text. Tapping any cell selects that day via a
`?day=YYYY-MM-DD` query param and opens a detail panel below the grid, at every width, listing each
job with its make/model (`vehicleMake`/`vehicleModel`) and its full work list (`labourLines[].description`)
— detail that never fit in a grid cell on desktop either, so this is a strict improvement there too.
With no day selected the panel falls back to an agenda of what's coming up (every day with a booking,
today onward) rather than going blank, so the multi-day-at-a-glance view mobile used to have is not
lost — only reachable one tap away from a specific day's detail.

**How the whole-cell tap target coexists with per-job chip links.** Each cell has a background
`<Link>` (`absolute inset-0`) selecting the day, and its content wrapper is `pointer-events-none` so
clicks pass through to it — except each `JobChip` gets `pointer-events-auto` back, which keeps it
individually clickable without nesting an `<a>` inside an `<a>` (invalid HTML). Verified directly
rather than assumed: `elementFromPoint` at a chip's centre resolves to the chip's own text node, and
an actual Playwright click on a rendered chip lands on `/jobs/<id>`, not the day-select overlay.

### Fixed (local dev only) — the job-number counter had drifted behind two soft-deleted test jobs

Not part of the request, found while seeding test data to verify the above. Two old jobs (J-0001,
J-0002) were soft-deleted locally, but `counters.next_value` for `'job'` still pointed at `1` —
`allocateNumber` returned 1 again, and the subsequent insert hit `jobs_job_number_key`'s unique
constraint on the still-present (soft-deleted) row, since a soft delete never frees its job number.
Reconciled `next_value` past the highest job number actually in the table. Local-environment data
drift only — this table doesn't exist on the production path in a way this touches, and the app code
that allocates numbers (`lib/counters.ts`) was not changed.

### Files Touched

- `app/(dashboard)/page.tsx` — `Kpi` takes an `href`, all six call sites link to their section.
- `app/(dashboard)/schedule/page.tsx` — grid always renders; new `?day=` selection; `JobDetailCard`
  and the agenda fallback; `JobChip` gained `className`/`vehicleDescription`; local-only counter
  reconciliation via direct SQL (no code change).

## 21/08/2026 @ 23:03:04 IST — "claude-opus-5"

**Project completion: 100.00%**

Basis: 7 of 7 items from this request shipped — the cash-basis Earnings rewrite, the split date
basis, the month drill-down showing received-vs-total, the corrected card labels, the forced
payment modal, the server-side guard against a bare `paid` transition, and the four missing
revalidation calls. Six of the seven were verified end-to-end in a real browser against a local
database seeded to mirror production's exact shapes; the seventh (revalidation) was verified by
inspection rather than by reproducing a stale cache, which is the same standard this project
already applies to the DB-down error boundary. Production figures were confirmed separately with a
read-only query against the live database before and after the change. 185 unit/integration tests
pass, typecheck and lint are clean.

### Fixed — Earnings showed €0 while €700 of real cash sat in the database

All three Earnings figures — "Earned all time", "30 day avg", and "Monthly" — read €0.00 / €0.00 /
"No earnings recorded yet." on production, while J-0020 (a €1,095 invoice) had €700 recorded
against it. Confirmed by direct query: there was not a single non-deleted job with
`status = 'paid'` in the database, so every earnings query returned nothing.

**Cause.** `getEarningsSummary` gated on `jobs.status = 'paid'` and summed the invoice's full
`grandTotal`. It never read the `payments` table at all. A partially-paid invoice therefore
contributed nothing no matter how much money had actually landed. This was a regression introduced
by the partial-payments feature (`a95fdc3`): that commit taught `getOutstandingInvoiceTotalCents`
to net payments out of "Owed", but left Earnings on the old status gate. The result was a ledger
that no longer balanced — J-0020's €700 dropped out of "Total outstanding" and arrived nowhere.

**Fix.** All three metrics now select `FROM payments`, joining out to `invoices` and `jobs`, with
no status gate — cash counts the day it lands. Voided invoices and soft-deleted jobs remain
excluded, unchanged. Before and after on live production data: **Earned all time €1,350 → €2,050**,
**30 day avg €45.00 → €68.33**, the difference being exactly J-0020's €700 partial.

**Why this and not a status fallback.** Counting `grandTotal` when an invoice has no payments was
rejected outright: it double-counts the moment a partial also exists, which would have reported
J-0020 as €1,095 + €700.

### Changed — the 30-day average now follows the payment date, the monthly breakdown does not

On 17/08 Earnings was deliberately moved onto `COALESCE(jobs.dueDate, invoices.issueDate)` because
two jobs due in June and July were both landing in August, the month their paperwork happened to be
generated. That reasoning is about **monthly attribution** and still holds, so the Monthly
breakdown is untouched.

It does not hold for a rolling average. A 30-day window keyed on when work was *scheduled* would
still not move when a payment is recorded today against a job due six weeks ago — the exact symptom
being reported here would have survived the fix, and today's data would have hidden that, because
J-0020's due date happens to fall inside the window. The trailing window therefore keys on
`payments.paidAt`, and a regression test covers a payment made today against a job due 60 days ago.

The window bound was also wrong: `>= CURRENT_DATE - INTERVAL '30 days'` spans 31 inclusive days
against a divisor of 30, quietly understating the average. It is now `29 days`, which is exactly 30
calendar days including today.

Because the two figures now use different date bases on purpose, each card names its own: "Cash
received", "Cash received, last 30 days", and "By job due date" on the Monthly header. The 30-day
card previously claimed "Paid invoices, by issue date", which was wrong even before this change —
the query had used the due date since 17/08.

### Changed — the month drill-down shows what was actually received

With the header now summing payments, listing each invoice's full `grandTotal` underneath would no
longer add up to it — J-0020 would have shown €1,095 under a €700 header. Expanding a month now
shows cash received per invoice with the invoice total beneath it when the two differ, so a partial
reads "€700.00 of €1,095.00" and the rows still reconcile with the header. `invoiceCount` uses
`COUNT(DISTINCT invoices.id)` so two instalments against one invoice stay one invoice.

### Added — setting a job's status to "paid" now forces the real payment flow

Every job page has a Status dropdown that could be set straight to `paid` with no payment recorded.
That was harmless while Earnings summed `grandTotal` off the status — but once Earnings sums
`payments`, such a job would claim to be settled while contributing nothing, reintroducing the same
money-disappears bug through a different door. Production contains no such job today, so the
verification above would have passed while the regression shipped.

Choosing `paid` now opens a blocking modal that records the actual payment — full or partial, the
same choice Awaiting Payments already offers — and the status flips as a *consequence* of the money
landing rather than instead of it. A partial leaves the job awaiting the balance, which the modal
says up front. On a job with no live invoice there is no amount to pay against, so the modal asks
for the invoice first and links to the Invoicer; payments attach to invoices, not jobs, and that
rule is not being bent.

The modal cannot be dismissed by clicking the backdrop, pressing Escape, or an X. The only ways out
are recording a payment or an explicit "Cancel — leave status unchanged", so a misclick on a
dropdown stays recoverable without offering a silent way to skip the money. It lives outside
`components/ui/index.tsx`, matching `time-off.tsx`, because that barrel has no `'use client'` by
design and a shared Modal there would force every consumer app-wide to become client-side.

`changeJobStatus` refuses `paid` server-side as well. The guard is in the action and not only the
UI because that is the layer that has to hold against a stale client or a future caller — the
Earnings comment now states the invariant and names the precondition it depends on.

**Note this closes an escape hatch:** both voiding and regenerating an invoice are refused once any
payment exists, so a job marked paid this way can no longer be voided or re-issued. That is correct
under the new model — marking paid now genuinely asserts cash was collected — but it is a
capability that existed before and does not now.

### Added — a shared PaymentForm

The modal and the Awaiting Payments button offer the same full/partial choice and write to the same
ledger, so duplicating the toggle and amount box would have let them drift. `PaymentForm` is
presentation only: it reports a chosen payment upward and never calls a server action, so each
caller keeps its own pending/error handling. No behaviour change to Awaiting Payments.

### Fixed — four mutations left the pages that display their results stale

Real staleness, though not the cause of the €0. `updateJob` can change `dueDate`, which is the
Monthly breakdown's grouping key, and `softDeleteJob` removes a job's money entirely — both
revalidated `/` but not `/earnings`. `factoryReset` omitted `/earnings` from its path list.
`/api/invoices/generate` imported nothing from `next/cache` at all, so issuing or regenerating an
invoice left the jobs list, the Overview and Awaiting Payments stale until a hard reload — the
Invoicer's own `router.refresh()` only refreshes the route it is mounted on. All now revalidate
what they actually change. Deliberately *not* `/earnings` from the generate route: Earnings sums
payments, a new invoice has none, and regenerating is refused once any payment exists.

### Expected behaviour that will look like a bug

Monthly buckets by job due date and orders newest-first, so **a deposit taken today on a job due
next month will appear as a future month at the top of the list**. Before this change a
future-dated job had to be fully paid to appear at all; now any deposit does it, and
deposit-now-balance-later is exactly what the `payments` table was built for. This is the chosen
semantics working as specified, not a defect.

Separately, "Earned all time" excludes fully-collected money on soft-deleted jobs — deleting a job
is how test money gets removed, and 18 of 24 production jobs are deleted test data.

### Files Touched

- `lib/db/queries/earnings.ts` — all three metrics rewritten onto `payments`; `EARNED_PAYMENT`
  replaces `EARNED_INVOICE`; new `LAST_30_DAYS`; month detail returns `receivedCents` + `grandTotal`
- `components/earnings/earnings-panel.tsx` — card subtitles, Monthly date-basis label, received-vs-total rows
- `components/payments/payment-form.tsx` — **new**, the shared full/partial payment UI
- `components/payments/mark-paid-modal.tsx` — **new**, the blocking modal and its no-invoice state
- `components/payments/mark-paid-button.tsx` — consumes the shared form
- `components/jobs/job-actions.tsx` — intercepts `paid`, opens the modal
- `app/(dashboard)/jobs/[jobId]/page.tsx` — derives the live invoice and remaining balance
- `lib/actions/jobs.ts` — `changeJobStatus` refuses `paid`; `/earnings` revalidation on update and delete
- `lib/actions/danger.ts` — `/earnings` added to the factory-reset path list
- `app/api/invoices/generate/route.ts` — the missing `revalidatePath` calls
- `tests/earnings.test.ts` — rewritten for cash-basis semantics
- `tests/job-status-guard.test.ts` — **new**, covers the refused `paid` transition
- `docs/superpowers/specs/2026-08-21-earnings-cash-basis-design.md` — **new**, the approved design
- `docs/superpowers/plans/2026-08-21-earnings-cash-basis.md` — **new**, the implementation plan

## 17/08/2026 @ 20:30:43 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 6 of 6 items from this request shipped and verified — the error-banner name fix, exact
job-time scheduling, chronological same-day ordering, the weekend-availability fix, the Settings
time-off modal, and time off struck off the Schedule calendar. Verified with a real browser against
both local dev (full round-trip: set a time, save, reload, confirm the stored value; add and delete
a time-off entry through the actual modal) and the live production deployment after the migration
and code both shipped (confirmed the "N jobs booked this month" line and the new Settings section
render correctly with real data). The error boundary's copy fix was verified by reading the
rendered file rather than forcing a live database outage on production, consistent with this
project's standing rule to only ever test that specific failure mode against a Preview deployment.

### Fixed — the error banner named the wrong person

The "can't reach your data" banner (added earlier today) read "Call Lee — 083 201 3732". That
phone number belongs to the dashboard's actual owner, but their name isn't Lee — `lee@` is just the
address the DB-down alert email happens to go to, and that got wrongly carried over into the
call-to-action's copy. Now reads "Call Support". A stray code comment in `job-form.tsx` had the
same mistaken assumption baked in (guessing why customer-form autofill is disabled) and is
corrected too, though it was never user-facing.

### Fixed — Schedule couldn't tell two same-day jobs apart, and miscounted "free" days

Two jobs booked for the same date rendered identically and in an arbitrary order (by job number),
because a job's `dueDate` was a bare date with no time component at all. Separately, the header's
"N free weekdays" figure explicitly excluded Saturday and Sunday from ever counting as free — correct
for a Monday-to-Friday business, wrong for this one, where the owner works weekends. Both traced
back to the same unexamined assumption: a conventional working week.

### Added — an optional exact time on every job, always sorted chronologically

`jobs` gains a nullable `due_time` column, stored as a plain `"HH:MM"` string rather than a Postgres
`TIME` column — `TIME` round-trips as `"HH:MM:SS"`, which would drift from what
`<input type="time">` both submits and expects back on the next load; text keeps read and write
byte-for-byte identical, confirmed against a real `psql` round-trip before committing to the column
type. Entered in the job form directly beside "Due date" as a 50/50 paired field, not a separate
row — one decision ("when"), not two. Schedule's query now orders by date, then time, then job
number, so a day's jobs are always chronological without the page doing any sorting of its own; the
month grid and the mobile agenda both display the time when one is set, "4:30pm" not "16:30".

### Changed — weekends count, no more "free days" figure

The header's "N free weekdays this month" line is gone outright rather than patched to include
weekends: once weekends are bookable and time-off days need to be excluded too, "free days" stops
being an honest single number and starts requiring a definition nobody asked for. The header now
just states jobs booked, plus — only when relevant — which days this month are blocked off (see
below). Weekend cells keep their existing subtle shading so they're still easy to spot at a glance,
but no longer count against the owner or get excluded from anything.

### Added — a time-off calendar in Settings, struck off the Schedule grid

New `time_off` table (start date, end date, optional label) — deliberately not FK'd to jobs, and
deliberately left out of the factory reset alongside `settings`: it isn't customer or financial
data, it's the owner's real calendar, and a "clear test data" button should not be able to erase it.
Settings gained a "Time off" card: an "Add time off" button opens this app's first real modal
(everywhere else — Mark as paid, Factory reset — uses an inline armed reveal specifically because
`components/ui/index.tsx` has no `'use client'` directive by design; this modal lives entirely on
its own outside that barrel, so it doesn't touch that constraint at all). Days covered by an entry
render struck through with an amber tint and an "Off" label on the Schedule month grid, and the
header line names the range in the months it falls in, e.g. "3 jobs booked this month · Off 20 Aug
– 22 Aug (Family holiday)".

### Files Touched

`app/(dashboard)/error.tsx`, `components/jobs/job-form.tsx` (comment only), `lib/db/schema.ts`
(`due_time` column, new `timeOff` table), `drizzle/migrations/0006_shiny_silver_centurion.sql` (new,
applied to both local and production), `lib/validation/common.ts` (new `optionalTime`),
`lib/validation/job.ts`, `lib/validation/time-off.ts` (new), `lib/db/queries/schedule.ts` (ordering,
`DayCell.isTimeOff`/`timeOffLabel`, `buildMonthGrid`'s new param), `lib/db/queries/time-off.ts` (new
— `listTimeOffInRange`, `listAllTimeOff`, `timeOffDateMap`), `lib/actions/time-off.ts` (new —
`addTimeOff`, `deleteTimeOff`), `lib/format.ts` (new `formatTime`), `components/settings/time-off.tsx`
(new — the modal), `app/(dashboard)/settings/page.tsx`, `app/(dashboard)/schedule/page.tsx`,
`app/api/export/jobs/route.ts` (due time added to the CSV), `tests/schedule.test.ts`,
`tests/time-off.test.ts` (new).

## 17/08/2026 @ 19:56:38 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 4 of 4 parts of the approved plan (cron time, DB-down email alerting, an in-app error
banner, payment history on the job page) are code-complete and pass static verification
(`typecheck`/`lint`/`test` all clean). 0 of 4 live checks from the plan's Verification section have
run yet — they need a real deploy, and the email alert specifically needs the user to finish a
stated prerequisite (Resend signup + domain verification + env vars) that hasn't happened. Scope
narrowed from an original four-issue list via three rounds of clarifying questions; two items were
explicitly parked, not built (see Changed, below).

### Goal

A review of the last five changelog entries surfaced four loose ends: an unconfirmed keep-alive
cron (was it actually stopping the Supabase project from pausing?), no alerting if the database
ever really did go down, no way to see a job's payment history now that partial payments exist, and
two deliberately-parked gaps (refund/credit-note flow, the status dropdown bypassing payment
tracking). Three rounds of questions narrowed this into a concrete plan; "proceed" carried it
through to code.

### Changed — cron moved off 4am UTC, to 2am Irish time

`vercel.json`: `"0 4 * * *"` → `"0 1 * * *"`. Vercel Cron schedules are fixed UTC with no DST
awareness, so this reads as 2am IST now and drifts to 1am once clocks go back to GMT in late
October — the closest a static schedule gets, and immaterial for a keep-alive ping. Frequency is
still once a day; this is a time-of-day change only.

### Added — email alert when the health check fails, and an in-app "can't reach your data" banner

New `lib/email/resend.ts` — this app's first transactional email integration. Lazy singleton
(`getResendClient()`) mirroring `lib/storage/r2.ts`'s `getR2()` exactly: the API key is read inside
the function, not at module scope, so a missing key fails only the first real send attempt, not the
build. `sendDbDownAlert(detail)` emails `lee@nolanautomotive.ie` (hardcoded — a known, stable
destination) every time `/api/health`'s `SELECT 1` fails, no dedup, so a multi-day outage keeps
nagging rather than alerting once and going quiet. The sender address is deliberately **not**
hardcoded (`RESEND_FROM` env var instead) — it depends on whichever domain actually gets verified
in Resend during setup, and a hardcoded guess that didn't match would have Resend reject the send
with `invalid_from_address`, silently swallowed by the health route's best-effort catch, with no
visible symptom at all. `/api/health`'s catch block now schedules the alert via Next's `after()` so
a slow or broken Resend call can never delay the 503 response itself, wrapped in its own try/catch
either way.

New `app/(dashboard)/error.tsx` — no error boundary of any kind existed anywhere in this app before
this. Renders inside `DashboardShell` (sidebar and chrome stay visible; only the failed page's own
content is replaced), confirmed safe because `app/(dashboard)/layout.tsx`'s `requireSession()` only
verifies a signed cookie and never touches the database — a DB outage can't take down the layout
itself before `error.tsx` gets a chance to catch it. Deliberately does not try to distinguish "this
specifically is a database error" from any other failure (a real distinction at the code level —
postgres.js throws a plain `Error` with an OS error code like `ECONNREFUSED` for a network failure
versus a `PostgresError` for other rejections — but a fragile one to lean on, and the safety advice
is identical either way): "Can't reach your data right now... Don't add, edit, or delete anything
until this is sorted," a "Try again" button wired to `reset()`, and a `tel:` link to call the owner.
No dismiss button — it only clears once a retry actually succeeds.

### Added — read-only payment history on the job page

`getJobWithAttachments` (`lib/db/queries/jobs.ts`) now nests one level deeper —
`invoices: { with: { payments: true } }` — reusing the `payments` relation added for partial
payments, so this is still one query. New `components/jobs/payment-history.tsx`, a plain Server
Component (no client JS needed) matching `InvoiceCard`'s visual style: date + amount only, no
running-balance column, flattened across the job's live (non-voided) invoices, placed directly
after `InvoiceCard` on the job detail page.

### Changed — two items explicitly parked, not built, recorded here so the reasoning isn't lost

Correcting an invoice after a deposit exists (a refund/credit-note flow) stays a hard block — "not
urgent," confirmed by the user. The job-status dropdown can still set a job to `paid` directly,
bypassing `recordPayment` entirely — "leave exactly as-is," matching this app's existing philosophy
that the owner can override any status at any time. Neither is flagged in-app; this changelog entry
and memory are the tracking mechanism, per the user's explicit call.

### Files Touched

`vercel.json`, `lib/email/resend.ts` (new), `app/api/health/route.ts`, `.env.example`,
`app/(dashboard)/error.tsx` (new), `lib/db/queries/jobs.ts`, `components/jobs/payment-history.tsx`
(new), `app/(dashboard)/jobs/[jobId]/page.tsx`, `package.json` + `pnpm-lock.yaml` (added the
`resend` dependency).

## 17/08/2026 @ 00:39:20 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 8 of 8 parts of the approved plan complete — schema + migration, the shared paid-amount
helper, the void and regenerate guards, the remaining-balance queries, the `applyPayment`/
`recordPayment` action, the UI, factory-reset accounting, and the new test suite — each verified
against both local and live production data, including the two correctness gaps found during
design review (not in the original request) that are now required, not optional, scope.

### Goal

"Mark as paid" on Awaiting Payments only supported settling a job in one click. Real billing here
often involves a deposit now and the balance later — the user's own example: a client pays part
upfront and the rest after 30 days. There was no way to record that, and no partial-amount concept
anywhere in the schema.

### Added — a `payments` table, and a derived "remaining balance" everywhere "owed" is computed

New `payments` table (`drizzle/migrations/0005_damp_peter_quill.sql`): money against a specific
invoice, not a running total on `jobs`/`invoices` — real billing here needs a history of separate
payments (a deposit, then a balance), not just one figure. Linked to `invoices`, not `jobs`, since
a payment is money against that invoice's `grandTotal` specifically.

**Deliberately no `jobStatusEnum` change.** "Partially paid" isn't a new status value — it's
derived, `SUM(payments.amount)` for an invoice vs. its `grandTotal`. A job flips to `status =
'paid'` only once the running total reaches the full amount, in the same transaction as the
payment that crosses that line. Every existing status-based query (Earnings, Overview's job-count
tiles, the job status dropdown) needed zero changes, and this avoided the costly cast-to-text →
remap → drop/recreate-type migration a real enum change would have required.

`getOutstandingInvoiceTotalCents` and `listAwaitingPayment` now sum/report `grandTotal` minus
whatever has already been paid, not the full invoice amount — a partial payment shrinks what both
the Awaiting Payments header tile and its row-level Total column show, and (a real bug found while
wiring this up, not present before) those two now read from the exact same field instead of being
two independent computations that could silently disagree with each other.

`recordPayment(invoiceId, { payInFull: true } | { amount })` is one action, two ways of arriving
at an amount, not two code paths — critically, `payInFull` resolves the amount **on the server,
inside the transaction, after locking**, never from a client-supplied figure (a second tab, or an
invoice edited moments earlier, could otherwise send a stale "remaining balance"). Verified live:
a job partially paid €30 of €120, then completed via "Paid in full," was charged exactly the
remaining €90 — not the original €120 — confirmed directly in the database, not just the UI.
Concurrent payments against the same invoice are serialised by locking the job row first
(`SELECT ... FOR UPDATE`), matching the exact lock target `/api/invoices/generate` already uses
for the adjacent "issue a new invoice" race — a real double-spend risk under Postgres's default
READ COMMITTED, not a hypothetical one, confirmed during design review before writing the code.

### Fixed — two correctness gaps a second review found, neither in the original request

Regenerating an invoice (editing a job and re-sending) overwrote its `grandTotal` in place with no
check against what had actually been paid — a fully-paid €500 invoice, re-sent after a missed part
is added, would have silently become €650 owed on €500 collected, with the €150 shortfall invisible
everywhere: not in Awaiting Payments (a `paid` job is excluded from that list by design), not
anywhere else. Voiding an invoice removed it from every money query, so a voided invoice's
payments — real cash already collected — would have vanished from every report too, while the job
was freed to be re-invoiced at full price with no record a deposit existed. Both routes now refuse
the mutation when the invoice has any payment recorded, naming the amount — verified live on both
local and production, exact wording confirmed (e.g. "NA-2026-0013 has €60.00 recorded against it
and can't be voided"). No refund/credit-note flow exists yet, so this is a stated MVP boundary, not
a silent gap to be discovered later.

### Changed — Mark as paid, no modal

Clicking "Mark as paid" now reveals, inline, "Paid in full — €X.XX" and "Partial payment" (which
reveals an amount field matching this app's existing money-input convention, plus a Save button) —
an armed reveal matching Settings' factory-reset pattern exactly, not a dialog/modal.
`components/ui/index.tsx` has no `'use client'` directive by design (it keeps the whole dashboard
renderable as Server Components); a `<dialog>`-based Modal added there would have forced every
component in that shared barrel — `Card`, `Table`, `Badge`, all of them — to become client-side at
every import site app-wide. There is also zero precedent anywhere in this app for an overlay modal.

### Also fixed — a real test-suite bug found while verifying this

Adding `tests/payments.test.ts` made an *existing*, unrelated test (`awaiting-payment.test.ts`'s
"still counts the job after its status moves away from invoiced") start failing consistently — not
flakiness, reproduced 4/4 times. Root cause: several `TEST_DATABASE_URL`-gated tests share one real
Postgres database and compare a global aggregate before and after a mutation; under Vitest's
default cross-file parallelism, one file's insert/delete can land inside another file's snapshot
window. Fixed at the root (`vitest.config.mts`: `fileParallelism: false`) rather than patching each
individual assertion — a suite this size costs a fraction of a second more to run serially, and it
removes the entire class of race for every current and future test rather than requiring every
future DB-test author to remember to avoid a "before vs after" pattern.

### Files Touched

`lib/db/schema.ts` + `drizzle/migrations/0005_damp_peter_quill.sql`, `lib/db/queries/payments.ts`
(new — `getPaidCentsForInvoice`, `applyPayment`), `lib/actions/payments.ts` (new — thin
session+validation wrapper), `lib/validation/payments.ts` (new), `app/api/invoices/[id]/void/route.ts`
+ `app/api/invoices/generate/route.ts` (guards), `lib/db/queries/{jobs,overview}.ts`,
`app/(dashboard)/awaiting-payments/page.tsx`, `components/payments/mark-paid-button.tsx`,
`lib/actions/{jobs,danger}.ts` + `components/settings/factory-reset.tsx` (payments count in
factory reset), `tests/payments.test.ts` (new), `vitest.config.mts`

## 17/08/2026 @ 00:12:00 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 3 of 3 date-basis SQL locations in `lib/db/queries/earnings.ts` switched from
`invoices.issueDate` to `COALESCE(jobs.dueDate, invoices.issueDate)`, verified by 7 of 7 passing
tests in `tests/earnings.test.ts` (5 existing + 2 new covering the switch and its fallback).
Scoped to this specific fix, reported directly by the user against yesterday's Earnings feature.

### Goal

Two real test jobs due in June and July, invoiced together today, both showed up entirely in
August's earnings — the month the paperwork happened to be generated, not the month the work was
actually due.

### Fixed

Earnings grouped and filtered by `invoices.issueDate` everywhere a date basis was used (the
monthly rollup, the 30-day trailing window, and the per-month invoice detail). Switched all three
to `COALESCE(jobs.dueDate, invoices.issueDate)` — due date first, since that's when the work
itself happened; falling back to issue date only for a job that never had a due date set, so
nothing is silently dropped from the breakdown. New test confirms a job due in one month but
issued in another lands in the due month; a second confirms the fallback still works when
`dueDate` is null.

### Files Touched

`lib/db/queries/earnings.ts`, `tests/earnings.test.ts`

## 16/08/2026 @ 23:20:57 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 15 of 15 files in this session's own approved plan (Part A: delete-supplier; Part B1-B4:
the Earnings view's query layer, actions, panel, routes, and cache-freshness wiring), plus all 4
live-verification checks the plan specified, each confirmed twice — once locally, once again on
production after deploy. Scoped to today's plan, same convention as the previous entry: not a claim
about the whole project, and the separate "keep-alive cron check" item from earlier entries is
untouched by this session.

### Goal

Two requests via `/goal`: fix a real bug (no way to delete a supplier from "Owed to others" at all),
and add a new "Earnings" view — all-time total, 30-day average, collapsible month-by-month breakdown
— shown inline on Overview for desktop and reached by a right-to-left swipe on mobile. The visual
reference was a screenshot of a Fansly earnings list; only the collapsible-monthly-list pattern was
borrowed, not its "Top X%" percentile badges, which have no equivalent on a garage's own books.

### Fixed — supplier deletion, and the receipt-orphan bug it would otherwise repeat

`lib/actions/suppliers.ts` had create/add-bill/mark-paid/delete-bill, but no way to delete a supplier
at all. `supplierBills.supplierId` is `ON DELETE CASCADE`, so a bare delete would have silently
orphaned every deleted bill's R2 receipt — the exact bug `deleteSupplierBill` itself had until it was
fixed earlier today, just for N receipts instead of one. New `deleteSupplier` reads every bill's
receipt path first, then a single bulk `removeObjects` call (the same helper the factory reset
already uses for this shape) before the cascade removes the rows. Wired into both the supplier list
and detail pages. Verified live, both places, both with a real uploaded receipt: delete removes the
supplier and its bills, and the same still-valid signed URL that served the receipt (`200`) before
deleting returns `404` after — proof the R2 object, not just the database row, is actually gone.

### Added — an Earnings view, deliberately cash-basis

Jobs carry no `paidAt` timestamp — only `supplierBills.paidAt` exists, for the other side of the
business. A direct production query, run before committing to a design, showed accrual revenue (every
non-voided invoice) and cash revenue (only invoices whose job is `paid`) diverging by tens of
thousands of euros, because this app already has a "Total outstanding" tile for invoiced-but-unpaid
work. Labelling accrual revenue "Earned" would have shown money that hasn't been collected, sitting
directly under a tile saying how much hasn't been collected. Earnings therefore only counts invoices
whose job is `paid`, non-voided, not soft-deleted, grouped by `issueDate`'s month as the best
available proxy for "when collected." Two small aggregate queries, not a row-level fetch — invoice
detail for a given month is fetched lazily via a server action only when that month is actually
expanded (collapsed by default, per spec), confirmed live to fetch exactly once per month regardless
of how many times it's re-collapsed and re-expanded.

Shown inline on Overview from `lg` up — not `xl`, which is what the sidebar/mobile-chrome switch
actually uses everywhere else in this app; gating on `xl` would have meant a real 1024-1279px desktop
viewport got the desktop shell but not this section. On mobile, reached at `/earnings` via a
right-to-left swipe or a tap-fallback pill (both needed — a gesture-only route is undiscoverable).
The swipe handler ignores drags starting inside a `<table>`: a page-wide handler would otherwise
compete with a wide table's own horizontal scroll in the 640-1023px tablet band, confirmed as a real
conflict (not hypothetical) before writing the guard, and confirmed live afterward that a swipe
starting on a table correctly does nothing while a swipe starting elsewhere still navigates.

Verified live on production end-to-end: created a throwaway job, invoiced and marked it paid — Earned
all time and the current month's row both picked it up immediately, 30-day average computed exactly
(÷30, e.g. €73.80 → €2.46); voided the invoice — both figures dropped back to zero. `<details>`/
`<summary>` used for the month rows rather than hand-rolled state, matching `job-form.tsx`'s existing
collapsible-section pattern.

### Files Touched

`lib/actions/suppliers.ts`, `components/suppliers/supplier-actions.tsx` (new),
`app/(dashboard)/suppliers/{page,[supplierId]/page}.tsx`, `lib/db/queries/earnings.ts` (new),
`lib/actions/earnings.ts` (new), `lib/validation/earnings.ts` (new), `tests/earnings.test.ts` (new),
`components/earnings/{earnings-panel,swipe-nav}.tsx` (new),
`app/(dashboard)/earnings/{page,loading}.tsx` (new), `app/(dashboard)/page.tsx`, `lib/actions/jobs.ts`,
`app/api/invoices/[id]/void/route.ts`

## 16/08/2026 @ 20:49:54 IST — "claude-sonnet-5"

**Project completion: 100.00%**

Basis: 18 of 18 items in this session's own approved plan — 12 fix items (A1–A6, B1–B3, C1–C3) plus
all 6 live-production verification checks the plan specified, all closed. This figure is scoped to
today's plan, not a claim about the whole project: the previous entries' separate "keep-alive cron
check" item (due on or after 22/08/2026) is untouched by this session and remains open against that
older tally, which this entry does not have access to and so does not attempt to extend.

### Goal

A broad bug-fix and turnaround/layout pass, requested directly: "suggest for me some bug fixes and/or
improvements/changes to make... shorter processes, quicker turnarounds, better layouts." Three parallel
research agents surveyed the codebase for data-integrity gaps, slow/wasteful flows, and mobile layout
issues; the highest-impact findings from each were verified directly against the code (one agent claim —
that parts `qty` should switch to `inputMode="numeric"` — was checked and found wrong against this app's
own domain knowledge that quantities are genuinely fractional, and dropped) before being written into a
plan and approved for the full scope, including the mobile table redesign.

### Fixed — a live invoice's money could vanish from every "owed" total without being voided

`getOutstandingInvoiceTotalCents` and `listAwaitingPayment` both filtered on `jobs.status = 'invoiced'`.
`changeJobStatus` lets the owner move a job's status to anything, any time — deliberately, so more work
found after invoicing doesn't get stuck. But flipping a job with a live €500 invoice back to `active`
silently dropped that €500 from Awaiting Payments and the Overview's outstanding total, while the
invoice itself stayed live and un-voided. Now both queries key "owed" off invoice truth instead: a
non-voided invoice on a job that isn't `paid`. Verified live: invoiced a real test job (J-0009,
€147.60), flipped its status to `active` — Total outstanding stayed at €63,449.55 and the job stayed
listed; voided the invoice — total dropped to exactly €63,301.95 and the job disappeared. New test:
`tests/awaiting-payment.test.ts`, gated on `TEST_DATABASE_URL` like the existing `allocateNumber` test,
since this is a JOIN + WHERE correctness property a mock can't demonstrate.

### Fixed — supplier bill receipts could be uploaded but never viewed, and leaked storage on delete

`bill-form.tsx` uploaded a receipt and stored `supplierBills.attachmentStoragePath`, but no route ever
signed a URL for it — `/api/attachments/[id]/signed-url` only ever queried `jobAttachments`. An uploaded
receipt was permanently unreachable. Worse, `deleteSupplierBill` deleted only the DB row, unlike
`deleteAttachment` for jobs, so every deleted bill with a receipt orphaned a file in R2 forever. Added
`app/api/supplier-bills/[id]/receipt/route.ts`, matching the invoice-PDF route's shape, and a "View
receipt" link next to each bill's actions. `deleteSupplierBill` now looks up the storage path first and
best-effort removes the R2 object before deleting the row. Verified live end to end: created a test
supplier and bill with a real receipt file, confirmed the signed URL genuinely served the file (`200`),
deleted the bill, then re-fetched the *same still-valid* signed URL and confirmed R2 now returns `404` —
proof the object was actually removed, not just the database row.

### Fixed — the parts-total preview could disagree with the stamped invoice for fractional quantities

`job-form.tsx` computed each part line as `toCents(qty) * toCents(unitPrice) / 100` — `toCents` only
keeps 2 decimal places, while `partLineSchema` permits 4. For qty `1.2345` at €10.00/unit, the live
preview showed €12.30 while the real invoice (via `applyQuantity`, the authoritative path) stamped
€12.35. Exported `applyQuantity` from `lib/money.ts` and made the form preview use it directly, so both
paths share one implementation. New test in `tests/money.test.ts` pins the exact case: `1.2345 × €10.00`
now agrees at €12.35 on both paths.

### Fixed — supplier/settings actions had no error handling, and money input had no digit cap

`createSupplier`, `addSupplierBill`, `setBillPaid`, `deleteSupplierBill`, and `updateSettings` had no
try/catch, unlike `createJob`. `supplierBills.amount` is `numeric(12,2)`, but `decimalString` had no
upper bound, so an oversized value passed validation and then threw an unhandled Postgres overflow out
of the server action. Wrapped each action body in try/catch returning a clean `{ ok: false, error }`.
Added an optional `maxIntegerDigits` to `decimalString` and applied an 8-digit cap to
`supplierBillInputSchema`'s amount. New test in `tests/validation.test.ts` confirms the cap rejects an
oversized value and a default (uncapped) schema still doesn't.

### Fixed — declared-but-unwired validation, and stale text from the old invoicing model

`EditorColumn.required` was set on the parts-name column but never applied to the rendered `<Input>`,
so a nameless part only failed server-side. `jobIdSchema`, `jobStatusChangeSchema`, `billIdSchema` were
defined but never imported by the actions that take a raw id string — now parsed at the top of
`changeJobStatus`, `setBillPaid`, and `deleteSupplierBill` before touching the database. Also corrected
three leftover descriptions of the old preview-then-commit invoicing model (Settings page, a doc comment
in `lib/invoices/build.ts`, and `peekNextNumber`'s comment in `lib/counters.ts`) to describe the current
one-step "generate is create" model.

### Changed — attachment uploads now run concurrently, not one at a time

The upload loop awaited get-signed-url → PUT → `recordAttachment` **per file**, fully serialising a
batch of job photos on the slow workshop connection this app is built for. Replaced the `for` loop with
`Promise.allSettled` over each file's independent pipeline — a bad photo no longer blocks or cancels the
others already in flight. Verified live: uploaded 4 files to a test job, confirmed all 4 in-flight rows
appeared simultaneously (not sequentially), all 4 settled in ~2.4s, and all 4 survived a hard page
reload, proving genuine server-side persistence rather than optimistic client state.

### Changed — saving an edited job no longer double-pushes browser history

`router.push` ran unconditionally on save, and for an edit it pushed the exact URL already on screen —
a duplicate history entry that made the owner tap Back twice to actually leave the job page. Now only
`push`es when creating a new job; an edit calls `router.refresh()` alone. Verified live: edited and saved
a real test job, then a single `history.back()` landed cleanly on `/jobs` — not stuck on the job page.

### Changed — the job form no longer re-renders on every keystroke in a labour/parts line

`LineEditor` lifted the full row array to `JobForm` on every character typed, and `JobForm` is one
unmemoized component, so typing a work description also re-executed the Customer, Vehicle, and
Scheduling sections and re-serialised the row JSON on every keystroke. Row state now lives entirely in
`LineEditor`; it reports only a derived `{ count, total }` upward via `onTotalsChange`, so an unrelated
keystroke that doesn't move the total triggers React's own bail-out on an unchanged primitive instead of
a full parent re-render.

### Changed — mobile table redesign, app-wide

Every table used `min-w-[36rem]` unconditionally, so a 5–6 column table needed a sideways scroll on a
390px phone — on Awaiting Payments, that scroll was the only way to reach "Mark as paid" at all. Added a
CSS-only responsive-table pattern to `globals.css` (rows become `data-label` + `::before` labelled cards
below 640px; a real `<thead>` from `sm` up) and rolled `label="…"` onto every `<Td>` across all six
tables in the app. Widened `sm`-sized row-action buttons to a real ~40px touch target (was ~34px) and
increased the gap between adjacent buttons in the attachment list. Smaller ordering fixes: the add-row
button now also appears after the last row (was only above the list), and the supplier/bill "Add" forms
now appear before their lists on a single-column phone. Verified visually — not just by reading the CSS
— at both 390px and 1400px, on real pages with real data, on this machine's dev environment and again on
the live production site.

**Deliberately not changed:** the plan called for adding `autoComplete="name"/"tel"/"email"` to the job
form's customer fields. Implemented, then reverted on reflection: those tokens are for the *signed-in
user's own* saved browser profile, and these fields hold the *customer's* details — a real, easy mistake
on a small screen (the owner's own name/number suggested into a customer field). Left at the default, so
the browser still offers plain form-history suggestions of previously typed customer names without
risking anyone's own identity landing in the wrong field.

### Files Touched

`app/(dashboard)/{awaiting-payments,jobs,settings,suppliers}/**`,
`app/api/supplier-bills/[id]/receipt/route.ts` (new), `app/globals.css`,
`components/jobs/{attachment-manager,invoice-card,job-form,line-editor}.tsx`,
`components/suppliers/bill-form.tsx`, `components/ui/index.tsx`,
`lib/actions/{jobs,settings,suppliers}.ts`, `lib/counters.ts`, `lib/db/queries/{jobs,overview}.ts`,
`lib/invoices/build.ts`, `lib/money.ts`, `lib/validation/{common,supplier}.ts`,
`tests/awaiting-payment.test.ts` (new), `tests/money.test.ts`, `tests/validation.test.ts`

## 16/08/2026 @ 16:46:11 IST — "claude-opus-5"

**Project completion: 99.29%**

Basis: 140 of 141 discrete build requirements. One was added and closed — analytics instrumented and
verified reporting. The open item remains the keep-alive cron check, due on or after 22/08/2026.

### Goal

Confirm Vercel Web Analytics and Speed Insights are active and working, on desktop and mobile.

### Found — enabled in Vercel, but the app never loaded them

Both products were already switched on for the project: `/_vercel/insights/script.js` and
`/_vercel/speed-insights/script.js` both served real JavaScript with the correct content type. But
neither package was installed and neither component was mounted, so **both dashboards were collecting
nothing.** Enabling a product in Vercel is only half of it; the app has to load it.

### Fixed — and the first fix did not work

Installing `@vercel/analytics` and `@vercel/speed-insights` and mounting the components was not enough.
On the live site the symptoms were precise and contradictory: `window.va` existed with a pageview
**sitting in the queue**, no script tag in the DOM, and no network request — while injecting the exact
same URL by hand returned 200. So the page could load it and the component simply never tried.

The cause is the **`/next` entry points**. They wrap the component in `<Suspense>` around a
`useSearchParams` hook, and on this app's statically prerendered pages that boundary does not resolve on
the client, so the component never mounts and `inject()` never runs. The generic **`/react`** entries
inject directly and have no such wrapper. After the switch, `window.vaq` is drained rather than stuck —
the signature of the real script taking over.

### The trap that nearly produced a false negative

Even with the scripts loading, no events were reported — and that looked like a second bug. It was not:
**Vercel suppresses bot traffic, and Playwright's default user agent says `HeadlessChrome`.** Under a
real Chrome UA the `POST /_vercel/insights/view` fires immediately; under the headless one it never does.

Worth recording, because the naive conclusion from an automated check is "analytics is broken" when the
product is in fact working exactly as designed.

### Verified live, both viewports

| | Desktop | Mobile (iPhone) |
|---|---|---|
| Web Analytics script | loaded | loaded |
| `POST /_vercel/insights/view` | **reporting** | **reporting** |
| Speed Insights script | loaded | loaded |
| `POST /_vercel/speed-insights/vitals` | **reporting** | **reporting** |
| Analytics cookies set | none | none |

On `main`, deployed to **Production**, nothing unpushed.

Cookieless matters here specifically: this dashboard holds customer names, addresses and phone numbers.
Web Analytics records paths and referrers, not people, and sets no cookies — confirmed above rather than
assumed. Speed Insights sends Core Web Vitals only.

### Files Touched

- `app/layout.tsx` — `<Analytics />` and `<SpeedInsights />` from the `/react` entries
- `package.json` — `@vercel/analytics`, `@vercel/speed-insights`

## 16/08/2026 @ 16:23:39 IST — "claude-opus-5"

**Project completion: 99.29%**

Basis: 139 of 140 discrete build requirements — the previous entry's three are now verified live, and
one was added and closed (moving the deep links under unit test). The open item is still the keep-alive
cron check, due on or after 22/08/2026.

### Goal

Verify the send flow against the live site, and put the part that no browser test can see under test.

### Changed — the deep links are now a tested unit

A `mailto:` is assigned to `window.location.href`, which issues **no network request**, so a browser
test cannot observe it. That is precisely why a missing recipient survived every test this project had.

`lib/send-links.ts` builds both links as pure functions, covered by 11 unit tests: the recipient is
present, subject and body are encoded, the `@` survives unescaped (encoding it breaks some clients), an
absent email still yields a valid link, the number is internationalised for `wa.me`, and an unusable
number falls back to the contact picker rather than opening the *wrong* chat.

A note for anyone testing this later: overriding `window.location` in Playwright to capture the mailto
**breaks Next's client-side navigation** and the page stops routing. Patch `window.open` only, and
assert the mailto through the confirmation the UI shows.

### Verified live on a freshly created job

| Check | Result |
|---|---|
| Create invoice | **5 seconds**, one step — previously two ~10s waits and two taps |
| Invoice row | created immediately, `sent_via`/`sent_at` null — issued ≠ sent |
| Numbering | exactly one number consumed |
| Email | opens addressed to `margaret@example.ie`, PDF downloaded to attach |
| WhatsApp | `wa.me/353874303785` — `087 430 3785` internationalised, message pre-filled |
| Delivery | recorded as `email`, then re-recorded as `whatsapp` |

### Noted — deployments stalled, and why

Between 13:23 and 15:29 Vercel stopped creating deployments: pushes landed on GitHub, no deployment
appeared, and the site carried on serving the previous build. Not a failed build — none was attempted.

It was **not** an account pause (no banner, and a manual redeploy ran fine), and the Git connection was
intact. The project was renamed in that window, which is the only change that lines up. A manual build
from `main` restored it, and pushes have auto-deployed since.

Two things worth remembering. **Vercel's Redeploy rebuilds the same commit, not the branch head** — the
sub-minute rebuild that resulted looked like a success but shipped nothing new; the live page still read
"previewing is free". And the migration in the previous entry was deliberately backward-compatible, so
the old build kept working against the new schema for the two hours it was serving.

### Files Touched

- `lib/send-links.ts`, `tests/send-links.test.ts` (new)
- `components/invoicer/send-bar.tsx` — uses the tested builders

## 16/08/2026 @ 15:28:38 IST — "claude-opus-5"

**Project completion: 99.28%**

Basis: 138 of 139 discrete build requirements. Three were added and closed here — issuing on generate,
a working mailto, and a working WhatsApp link. The open item remains the keep-alive cron check, due on
or after 22/08/2026.

### Goal

Make sending an invoice fast and actually reach the customer. Three faults, one of them structural.

### Fixed — mailto: had no recipient

The link was `mailto:?subject=…&body=…`. **No `to` address at all**, so it opened a blank compose and
the owner retyped the customer's email every time — even though the job already holds it. It now
addresses `customerEmail`, with the subject and message pre-filled.

### Fixed — the WhatsApp link had no number

`https://wa.me/?text=…` with no number opens a contact picker rather than the customer's chat. The job
holds `customerPhone`, and it was never used.

Passing it straight through would not have worked either: `wa.me` needs a full international number with
no `+`, no spaces and no leading zero, so the `087 430 3785` an Irish number is written as has to become
`353874303785`. `lib/phone.ts` does that conversion, covering national, `+353`, `00353`, punctuated and
already-international forms, and returning null for anything unusable so the link falls back to the
picker rather than opening the wrong chat. Eight unit tests.

### Fixed — on a phone, neither button did what it said

The channel was only honoured in the *fallback* branch, reached when the browser could not share files.
On a phone `canShareFiles` is true, so tapping **Email** or **WhatsApp** opened the generic share sheet
and the choice was discarded. Both now always open their own platform.

### Changed — the invoice is created when it is generated

Previously: generate stamped a preview (~10s), then picking a channel allocated the number, **re-stamped
the whole PDF**, uploaded it, and only then offered a second tap to actually send. Two long waits and
two taps to send one invoice, which is what made the app feel slow.

Now generating *is* creating. One stamp, one upload, one wait — and Email, WhatsApp and Share act
instantly afterwards because there is nothing left to commit.

The old split existed to keep the number sequence gap-free by not burning a number on an abandoned
preview. **That property survives, and more simply:** every number now has a real invoice row behind it,
so there are no gaps by construction. An invoice generated and then thought better of is voided — the
mechanism that already existed for exactly that case.

Issuing and sending are now separate events in the data too: `sent_via` and `sent_at` became nullable,
because an invoice can legitimately exist before it has been sent, or never be sent at all. Delivery is
recorded by `/api/invoices/[id]/sent`, fired without blocking so a slow network delays the *record*
rather than the send. `createdAt` is when it was issued; `sentAt` is when the customer got it.

Two consequences handled: the "recently invoiced" list and the CSV export now order by `createdAt`,
since Postgres sorts NULLS FIRST on a DESC and unsent invoices would otherwise float to the top; and
`/api/invoices/finalize` and `/api/invoices/[id]/regenerate` are deleted, their work folded into
`generate`, which now issues or regenerates as appropriate. One route issues invoices.

### Fixed — a dead control found while wiring it up

After issuing, the primary button read **Update invoice** but was disabled by the same `locked` flag
that disables the job picker. It is exactly when that button is useful — edit the job, come back,
restamp under the same number — so it now stays enabled, blocked only mid-stamp or when regenerating
would replace a real invoice with a blank one.

### Files Touched

- `lib/phone.ts`, `tests/phone.test.ts` (new) — `wa.me` number normalisation
- `components/invoicer/send-bar.tsx` — one-tap send, real recipients, PDF downloaded alongside
- `components/invoicer/invoicer.tsx` — issue-on-generate, delivery recording, copy corrected
- `app/api/invoices/generate/route.ts` — issues or regenerates
- `app/api/invoices/[id]/sent/route.ts` (new); `finalize` and `[id]/regenerate` deleted
- `lib/db/schema.ts`, `drizzle/migrations/0004_tiny_sentinel.sql` — nullable send fields
- `lib/db/queries/{jobs,overview}.ts`, `app/api/export/invoices/route.ts` — recipients, ordering

## 16/08/2026 @ 13:23:19 IST — "claude-opus-5"

**Project completion: 99.26%**

Basis: 137 of 138 discrete build requirements. Three were added and closed by this entry — the
attachment-opening fix, the invoice-link prefetch fix, and removing the Invoicer shortcut from the job
screen. The one open item is still the keep-alive cron check, due on or after 22/08/2026.

### Goal

Fix attachments that could not be viewed, and confirm downloading works for every kind of file.

### Fixed — View opened a popup the phone silently blocked

**Root cause.** View and Download fetched a signed URL and *then* called `window.open()`. Because that
runs after an `await`, it is no longer inside the click's own call stack, so browsers classify it as a
programmatic popup. Desktop Chrome permits it — which is exactly why it passed every test I had — but
iOS Safari does not, and inside the installed standalone PWA, which is how the owner actually uses this,
View did nothing at all.

**How it was found.** Both engines available here opened the file happily: Chrome rendered the image,
and WebKit did too. Neither could reproduce it, because Playwright disables popup blocking in
automation. Measuring `navigator.userActivation.isActive` at the moment of the call showed it `true`
with a 344ms fetch — Chrome's activation window is five seconds, so it survives on a laptop and expires
on the stricter rules the phone applies.

What settled it was not the environment but the codebase: `/api/invoices/[id]/pdf` is a plain `<a href>`
to a route that 307s to a signed URL, and **those links have always opened for the owner.** Same
storage, same signing, same private bucket — the only difference was the mechanism.

**The fix** is to stop opening files programmatically. `?redirect=1` makes the attachment route 307 like
the invoice route already did, and View/Download are now ordinary links. No JavaScript runs, so there is
no popup to block, on any browser or in standalone mode.

### Fixed — the invoice number was firing a cross-origin prefetch

Found while reproducing. The invoice number used `next/link`, which prefetches its target; that target
307s to a signed R2 URL, so merely hovering a row fired a cross-origin prefetch that failed CORS and
filled the console with errors. It is a file download, not a route — plain `<a>`.

### Removed — the Invoicer shortcut on the job screen

Invoicing starts from the Invoicer, reached from the sidebar or the phone's bottom bar, where a job is
chosen and the invoice generated. One route in rather than two.

### Verified live, across every file type

Uploaded one of each and followed both links end to end, then removed the test files so the job was left
as found.

| File | View | Download |
|---|---|---|
| `image.jpg` (4MB) | 200, `image/jpeg`, inline | 200, `attachment; filename="image.jpg"` |
| `photo.png` | 200, `image/png`, inline | 200, correct filename |
| `receipt.pdf` | 200, `application/pdf`, inline | 200, correct filename |
| `notes.txt` | 200, `text/plain`, inline | 200, correct filename |
| `scan.dat` (unknown type) | 200, `application/octet-stream`, inline | 200, correct filename |

Also confirmed: every View and Download is a real `<a href>` rather than a scripted button, no "Open
Invoicer" remains on the job page, and hovering the invoice link no longer fires a prefetch.

### Files Touched

- `app/api/attachments/[id]/signed-url/route.ts` — `?redirect=1` returns a 307
- `components/jobs/attachment-manager.tsx` — View/Download become plain links
- `components/jobs/invoice-card.tsx` — `next/link` → `<a>` for the PDF
- `app/(dashboard)/jobs/[jobId]/page.tsx` — Invoicer shortcut removed

## 16/08/2026 @ 13:10:10 IST — "claude-opus-5"

**Project completion: 99.26%**

Basis: 134 of 135 discrete build requirements. One was added and closed by this entry — a written home
for deferred work. Nothing was implemented: the arrival/due-back change was designed, then parked at the
user's direction because the garage does not need it to run today. Deferred work is not counted as
outstanding build requirements; it is recorded in `ROADMAP.md`. The one genuinely open item remains the
keep-alive cron check, due on or after 22/08/2026.

### Goal

Stop losing decisions. Give considered-but-deferred work a home in the repository rather than in a
planning file on one machine.

### Added — `ROADMAP.md`

Four items, each raised, thought through, and deliberately not built:

1. **Arrival date and due-back-to-customer date** — designed in full, including the four decisions that
   fix the arithmetic (8-hour days hard-coded, weekends skipped, first day counts, Schedule spans every
   working day), the worked examples, and the suggested shape. Anyone picking it up starts from a
   settled design rather than the same four questions.
2. Job value on the jobs list.
3. A "Ready to invoice" tile on the Overview.
4. Private repository, with the two routes to it and why neither is urgent.

Plus the recurring cron check, which is a calendar item rather than a feature.

### Noted — the label is wrong, the code is not

The job form asks for a **"Due date"**, but that date is the day the car **arrives**. The code has always
known this: `lib/db/queries/schedule.ts` opens with *"A job's `dueDate` is the day it is booked in for"*.
So the eventual fix is a relabel plus a derived date — not a data migration.

Recorded now because it is the kind of thing that reads as a bug six months from now, and because the
Schedule's "free weekdays" figure is quietly optimistic until the spanning change lands: it marks only
arrival days, so a week holding one long job currently looks empty.

### Files Touched

- `ROADMAP.md` (new)
- `README.md` — links to it from Contents
- `CHANGELOG.md`

## 16/08/2026 @ 12:51:48 IST — "claude-opus-5"

**Project completion: 99.25%**

Basis: 133 of 134 discrete build requirements. The fourteen skeleton requirements from the previous
entry are now verified on the live site and count as done; streaming the Overview's sections adds two
more (the Suspense split and its verification), both done. The one outstanding item is not code:
confirming the daily keep-alive cron has run, due on or after 22/08/2026.

### Goal

Verify the skeletons against real screens rather than assuming they fit, and stop the Overview blocking
on its slowest query.

### Fixed — the Settings skeleton was 690px short

Measured against the live page, the Settings placeholder came out **39% shorter** than the content that
replaced it — a visible jump, and precisely the layout shift a skeleton exists to prevent. The guess was
four uniform field cards; the page actually renders five, with a 3-row `Textarea` for the address and a
checkbox row leading the VAT card. Rebuilt to match: the gap closed from 39% to 25%, and the residual is
the form growing downward below the fold rather than anything moving under the reader.

This is the finding that justified measuring at all. Every other route was within 10% first time, so
eyeballing screenshots would have passed Settings too.

### Added — the Overview streams section by section

Its six reads were a single `Promise.all`, so the page waited on the slowest before showing anything.
Each section now owns its query behind a Suspense boundary and arrives independently — the three fast
count aggregates paint while the invoice join is still running — falling back to the same skeletons
`loading.tsx` uses, so there is no visual seam between the two mechanisms.

`loading.tsx` covers the navigation; Suspense covers what happens after the shell is up.

### Verified on the live site

Skeletons were held on screen by delaying only the RSC payloads — client-side navigation, so the
document survives and the placeholder can be measured rather than merely photographed.

| Check | Result |
|---|---|
| Placeholder height vs real height | within 10% on six of seven routes; Settings 25% after the fix |
| Skeleton blocks rendered per route | 28–109, every route non-zero, desktop and phone |
| Light mode token | `rgb(230, 233, 238)` — correct |
| Explicit `[data-theme="dark"]` | `rgb(35, 41, 50)` — correct, not glowing white |
| `prefers-reduced-motion: reduce` | sheen animation `none`, placeholder still visible |
| Overview after restructuring | all tiles and both tables render; outstanding still €836.50, void still excluded |
| Skeletons after load | zero remain |

### Files Touched

- `app/(dashboard)/settings/loading.tsx` — rebuilt to the real five-card shape
- `app/(dashboard)/page.tsx` — split into streaming sections behind Suspense
- `CHANGELOG.md`

## 16/08/2026 @ 12:35:36 IST — "claude-opus-5"

**Project completion: 89.39%**

Basis: 118 of 132 discrete build requirements. Fourteen were added by this entry — the skeleton
primitive, the shared blocks, ten route-level loading states, the invoice-generation placeholder and the
upload placeholders. All are written, typechecked and linting clean, but **none is counted done until it
has been looked at on a real screen**: a loading placeholder that does not match its content causes the
exact layout shift it exists to prevent, and that is a visual defect no test catches.

### Goal

Give every screen a loading state, so the app stops showing blank space while it waits on the database.

### Added — skeleton loaders across all ten routes

Every data-backed route gets a `loading.tsx`: Overview, Jobs, a job, a new job, Schedule, Invoicer,
Awaiting payments, Suppliers, a supplier, and Settings. In the App Router these stream instantly while
the page's own data is still being fetched, so the placeholder is in the first byte of HTML — no hook,
no effect, no hydration.

**The governing rule is that a skeleton must occupy the same space as the content it replaces.** A
placeholder of the wrong height causes the shift it was meant to prevent: the page settles, and the
owner's thumb — already moving — lands on the wrong row. So the blocks are built from the same markup as
their real counterparts. `SkeletonTable` carries the same `min-w-[36rem]`, the same `px-3 py-2` and the
same bottom borders as `Table`/`Th`/`Td`; `SkeletonCardHeader` matches `CardHeader`'s border and
padding exactly; the grid classes in each `loading.tsx` are copied verbatim from its `page.tsx`.

Two places where matching the *state* mattered as much as the size:

- **The job forms** render their sections collapsed or expanded exactly as the real form does — only
  Registration, Customer and Vehicle are open on a new job. Showing every section expanded would make
  the page jump several hundred pixels upward on arrival.
- **The Schedule** renders a 7×6 month grid from `md` up and an agenda list below it, mirroring the
  page's own breakpoint, so a phone never draws a calendar skeleton for a calendar it is not about to
  show.

### Added — placeholders for the two real client-side waits

- **Generating an invoice** takes ten seconds or more on a cold function. A dimmed button reads as
  nothing happening, so the preview pane now shows the shape of the document being assembled, at the
  height of the real preview.
- **Uploading photos** shows one row per file, carrying that file's own name, and each row disappears as
  its upload lands — so sending five photos visibly counts down instead of sitting behind a generic
  "Uploading…".

### Design notes

A **travelling sheen**, not `animate-pulse`. A pulse fades whole blocks in and out; twenty of them on one
page reads as flicker. A sheen moving one way reads as "loading, left to right" and stays calm. It
animates `transform` only — a `background-position` animation repaints every frame, and there can be
dozens of these at once on a mid-range Android.

`prefers-reduced-motion: reduce` stops the movement while keeping the placeholder, because travelling
motion is genuinely unpleasant with a vestibular disorder and a loading state is not worth that.

Skeletons get their **own colour token** rather than reusing `--line`: a placeholder needs to read as
"content pending" rather than as a border, and the two need different contrast in dark mode. Defined for
light, for `prefers-color-scheme: dark`, **and** for the explicit `[data-theme="dark"]` override — miss
the third and skeletons glow white for anyone who picked dark manually.

The shapes are `aria-hidden`, with one polite live region per screen, so a screen reader hears
"Loading jobs" once instead of forty empty boxes.

**Deliberately not applied:** the `high-end-visual-design` skill's luxury motion — cinematic reveals,
`py-40` rhythm, glass and blur. Its own guidance excludes constrained dashboards, and it is right: this
is a tool a mechanic uses on a phone with oily hands. Its performance and CLS rules were applied in
full; its aesthetics were not.

### Files Touched

- `components/ui/skeleton.tsx` (new) — the primitive and every shared block
- `app/globals.css` — skeleton tokens for all three theme paths, the sheen keyframes, reduced-motion
- `app/(dashboard)/**/loading.tsx` (10 new files)
- `components/invoicer/invoicer.tsx` — the PDF-generation placeholder
- `components/jobs/attachment-manager.tsx` — per-file upload rows

## 16/08/2026 @ 12:22:05 IST — "claude-opus-5"

**Project completion: 100.00%**

Basis: 118 of 118 discrete build requirements. The last open item — repository visibility — is now
**closed as "must remain public"**, which is a resolved decision rather than an outstanding task: Vercel's
Hobby plan cannot deploy a private repository whose commits are authored by a collaborator. One
non-build item remains on the calendar rather than the checklist: confirming the daily keep-alive cron
has run, due on or after 22/08/2026.

### Goal

Establish why making the repository private broke deployment, restore the pipeline, and write the
constraint down so it cannot be rediscovered the expensive way.

### Fixed — deployments were silently blocked, not failing

Making the repo private stopped every deploy. Vercel's reason, once read:

> "The deployment was blocked because the commit author did not have contributing access to the project
> on Vercel. The Hobby Plan does not support collaboration for private repositories."

The commits here are authored by the developer's personal GitHub account, a **collaborator** — not by
`lnautomotive2025-8997`, which owns the Vercel project. Public repositories permit collaborators;
private ones do not, on Hobby. Repository ownership type, which is what I had checked, is not the
relevant axis at all: **commit authorship versus the Vercel account owner** is.

**This misdiagnoses easily.** GitHub reports the commit status as `failure`, which reads as a broken
build — but nothing was ever built. The deployment description is `Deployment was blocked`, the site
carries on serving the previous build, and the only real symptom is that changes quietly stop shipping.
The README now documents the two `gh api` calls that distinguish the two cases without needing Vercel
credentials.

Repository restored to public; the blocked commit was republished and verified live.

### Fixed — I gave bad advice, and it cost a broken pipeline

I told the user making the repository private "won't break anything", having checked repo ownership
type, Actions minutes, the GitHub App's access and public-raw-URL dependencies — but not Vercel's
collaboration rules. That the site never went down was luck of the design (the previous build keeps
serving), not foresight.

Recorded because the useful lesson is not "private repos are bad" but that a deployment pipeline has
constraints on **who commits**, not only on what the repository is.

### Verified live

- The previously blocked commit now deploys and serves: selecting a job with no work lines or parts
  shows the new alert and the send bar is **disabled**, instead of letting the owner tap send and
  receive a 400 from the server guard.
- J-0003 was emptied to force that state and restored afterwards to its three work lines and two parts.

### Files Touched

- `README.md` — the public-repo requirement, why it misreads as a build failure, and how to check it
- `CHANGELOG.md`

## 16/08/2026 @ 11:59:37 IST — "claude-opus-5"

**Project completion: 99.15%**

Basis: 117 of 118 discrete build requirements — unchanged, because this closes the last open one
(repository visibility) while adding one new requirement (the UI mirroring the regenerate guard). The
remaining item is confirming the daily keep-alive cron has run, due on or after 22/08/2026.

### Goal

Make the repository private without breaking deployment, and prove that rather than assume it.

### Changed — the repository is private

Now private under the client's `LN-git1` account. Checked before recommending it, because a wrong answer
here takes the site's deploy pipeline down:

- The repo is **user-owned, not an organisation**, so Vercel's Hobby plan still deploys from it.
- Vercel's GitHub App holds per-repository access, which a visibility change does not revoke.
- There is no `.github/workflows` directory, so no Actions minutes start being billed.
- Nothing in the codebase depends on public raw GitHub URLs.

Worth recording for the next person: **a collaborator cannot do this.** On a user-owned repository
GitHub grants collaborators write access only — the granular read/triage/write/maintain/admin roles exist
solely on organisation repositories — and visibility changes are restricted to the owner. The developer's
personal account is a collaborator with `push: true, admin: false`, and the API answers a visibility
PATCH with 404 rather than 403, which reads like a missing repository rather than a permissions wall.

### Added — the Invoicer now mirrors the regenerate guard

The server refuses to re-send an invoice from a job with no work lines or parts, because doing so would
overwrite the customer's copy with a blank. The Invoicer still offered the send buttons in that state, so
the only way to discover the rule was to tap send and get a 400 back.

The send bar is now disabled in exactly that case, with an alert naming the invoice and offering the two
real options: put the work back on the job, or void the invoice if it was issued in error. The server
check stays — it is the actual boundary; this is just the UI telling the truth about it.

### Files Touched

- `components/invoicer/invoicer.tsx` — `wouldBlankInvoice` guard on the send bar and its alert
- `CHANGELOG.md`

## 16/08/2026 @ 11:34:50 IST — "claude-opus-5"

**Project completion: 99.15%**

Basis: 117 of 118 discrete build requirements. Three were added by this entry — the regenerate safety
guard, the legacy backfill, and void-aware Overview figures — and all three are now verified on the live
site (13 further checks, all passing). The single remaining item is making the GitHub repository private,
deferred by the user.

### Goal

Fix two defects the previous session's 68 checks structurally could not catch, because every one of them
ran against a job created in the **new** shape. Nothing had touched the pre-existing data.

### Fixed — a pre-rework invoice could be silently blanked

`NA-2026-0001` is a genuine **€2,136.99** invoice (four tyres, clutch, flywheel, full service). It was
issued before the invoice content moved onto the job, so its content lived only in the invoice's own
snapshot — and migration 0001 defaulted `jobs.labour_lines` and `jobs.parts` to empty.

Regenerating reads the *job*. For any such invoice it would find nothing and overwrite the stored PDF at
the same storage path with a blank €0.00 document, replacing the customer's only copy. The UI showed an
alert but did not disable the send buttons, so nothing actually prevented it.

**Scope, stated accurately:** this specific invoice's job, J-0001, turned out to have been soft-deleted
on 15/08, and `listInvoiceableJobs` filters deleted jobs — so NA-2026-0001 was not in fact reachable
from the Invoicer. The exposure was to any pre-rework invoice on a *live* job, and to J-0001 itself the
moment anyone restored it. The first draft of this entry claimed it was "one tap from destruction"; that
overstated it, and the check that established the truth was reading `deleted_at`, not re-reading the
code.

Two fixes, because one is a floor and the other is the repair:

- **`/api/invoices/[id]/regenerate` now refuses** to replace a non-zero invoice with a zero one, naming
  the job and the amount at risk. A genuinely zero invoice regenerated from a zero invoice is still
  allowed — it is the transition from *has value* to *has none* that is blocked.
- **Migration 0003 backfills** job content from any pre-rework invoice's snapshot, so an old invoice can
  be corrected and re-sent like any other rather than merely being blocked. Verified on the live data:
  J-0001's four work lines and four parts are restored, and €600 labour + €1,536.99 parts reconstructs
  the original €2,136.99 exactly.

  Per-line hours are deliberately **not** invented — the old template printed a single AMOUNT, so how
  `labour_hours` split across four description lines is genuinely unknown. Each line gets a blank HOUR(S)
  cell and the money is preserved exactly via `labour_total_override`, rather than re-derived from
  hours × rate and drifting by a cent.

### Fixed — the Overview was counting a voided invoice as money

The previous entry claimed "the finalize duplicate check, the Invoicer picker, Awaiting payments and the
Overview totals all ignore voided rows." The first three were true. `lib/db/queries/overview.ts` was
never opened, and `getOutstandingInvoiceTotalCents` summed `grandTotal` with no void filter — so the
voided **NA-2026-0002 (€836.50)** was being reported as outstanding on the live dashboard. The claim was
written from intent rather than from the code.

Fixed in both places it mattered: the outstanding total, and `listRecentInvoices`, where a voided invoice
would have read as recent business taken. It remains visible on its own job, marked VOID.

### Verified on the live site

- **Overview** reports €836.50 — the one live invoice. Not €1,673.00 (the void leaking back in) and not
  €0.00 (the filter overreaching).
- **The guard holds.** Emptying J-0003's work lines and parts and calling `/regenerate` directly returned
  **400**, named the job and the €836.50 at risk, and left the stored invoice untouched. J-0003 was then
  restored to its three work lines.
- **The backfill is exact.** J-0001 carries four work lines and four parts, and €600 labour + €1,536.99
  parts reconstructs €2,136.99 — the original grand total, to the cent.

### Files Touched

- `lib/db/queries/overview.ts` — exclude voided invoices from the outstanding total and recent list
- `app/api/invoices/[id]/regenerate/route.ts` — refuse to blank a non-zero invoice
- `drizzle/migrations/0003_backfill_job_invoice_content.sql` (+ journal, snapshot) — backfill
- `CHANGELOG.md`

## 16/08/2026 @ 11:29:01 IST — "claude-opus-5"

**Project completion: 99.13%**

Basis: 114 of 115 discrete build requirements. The twelve requirements added in the previous entry are
now **verified end-to-end on the live site** — 68 checks across four passes, all passing — so they move
from open to done. The single remaining item is making the GitHub repository private, which the user
deferred deliberately and which needs an account action, not code.

### Goal

Prove the job-centred rework actually works against the live database and the real template, rather than
against a local approximation of them.

### Verified on https://dashboard.nolanautomotive.ie

**No database reset at any point.** Test jobs and invoices accumulated instead, per the standing
instruction — assertions are on *deltas* (counter before vs after) rather than on absolute emptiness,
which is what makes testing on live data honest rather than destructive.

- **Status** — the dropdown offers exactly active/completed/invoiced/paid; the two pre-existing jobs
  survived the enum swap untouched.
- **Registration prefill** — entering a known registration offered the previous customer and vehicle and
  filled name, phone and colour correctly.
- **The job owns the content** — a job created with three work lines, a rate, two parts, comments and
  private notes reopened with every value intact and editable.
- **Hours maths** — 5 + 2 + 3 auto-summed to 10, and at €60 gave a labour total of exactly €600.00.
- **Custom total** — €450 overrode hours × rate, greyed out the rate box, and clearing it returned to
  €600.00.
- **Preview is free** — three previews left the invoice counter unmoved and created no row.
- **Send** — exactly one number consumed, grand total €776.50 stored, labour lines snapshotted, job
  flipped to Invoiced.
- **Edit and re-send** — changing one line's hours from 5 to 6 and re-sending kept the **same invoice
  number** and **same storage path**, updated the stored total to €836.50, moved `sent_at` forward, and
  consumed **no** new number. The stored PDF was then downloaded and read back: it shows 836.50, the
  original 776.50 is gone, and the hours column reads 6, 2, 3 — proof the file was genuinely replaced
  rather than a stale copy left behind.
- **Void** — marked void rather than deleted, dropped out of Awaiting payments, returned the job to
  Completed, and consumed no number. Reissuing then produced **NA-2026-0003** while the voided
  **NA-2026-0002** stayed on record, never reused.
- **Paid-job edit** — warns before replacing a copy the customer already holds.
- **Wording** — no "Services" anywhere in the UI, in the stored PDF, or in the CSV export, which now
  reads "Total labour" and carries a "Voided at" column.
- **Phone** — 390×844: collapsed form 1721px with no horizontal overflow, sections open on tap, work
  lines add cleanly, and the hours box requests the numeric keypad.
- **Regression** — all seven pages load and all three CSV exports download.

### Fixed during the pass

**A verification probe that proved nothing.** Checking whether the deploy had landed by asking whether
`/api/invoices/<id>/void` existed returned 401 — but so did `/api/definitely-not-a-route`, because the
auth gate answers 401 for every `/api/*` path, real or not. The probe would have reported success against
the *old* deployment. Replaced with a check that logs in and reads the actual form.

### Files Touched

- `CHANGELOG.md` — this entry

## 16/08/2026 @ 11:17:19 IST — "claude-opus-5"

**Project completion: 89.47%**

Basis: 102 of 114 discrete build requirements. The previous count of 102 is now fully closed — the
Zoho mailbox, the last open item, was set up and its DNS verified. Scope then grew by **twelve** new
requirements from this session's rework, of which the code for all twelve is written, typechecked and
unit-tested but **not yet verified end-to-end on the live site** — so they are counted as open, not
done. The figure will move once that pass runs. Also outstanding and deliberately deferred by the
user: making the GitHub repository private.

### Goal

Make the **job** the single record of the work. Everything that ends up on an invoice is entered once,
on the job, and stays editable forever — which is what finally makes a sent invoice correctable.

Five changes drove it, all from the owner actually using the thing:

1. Job status `new` was dead weight.
2. The Invoicer was the wrong home for job details.
3. "Services" is not the word a mechanic uses.
4. Labour is not always hours × rate.
5. The reworked template prints **hours** per line, not money.

### Changed — the job now owns the invoice

Work, labour, parts and comments moved off the invoice payload and onto the job (`labour_lines`,
`hourly_rate`, `labour_total_override`, `parts`, `other_comments`). The invoice request is now
literally `{ jobId }`.

This is what makes the rest fall out for free: **"editing an invoice" is just editing the job and
regenerating.** There is no separate invoice editor to build, no second copy of the fields, and no way
for a job and its invoice to disagree. `/api/invoices/[id]/regenerate` re-stamps from the job's current
content while keeping the invoice number, the original issue date and the storage path — so the
customer keeps one reference for one repair, the sequence grows no gaps, and the stored PDF is replaced
rather than accumulating orphans. No counter is touched, so it is safe to run repeatedly.

The invoice row still snapshots its own totals, rewritten on every regeneration, because money owed and
the CSV exports must keep reporting what was actually sent even as the job is edited.

### Added — voiding, because deleting was never an option

`/api/invoices/[id]/void` marks an invoice void and returns its job to Completed so it can be reissued
under a fresh number. The row and its number are kept: deleting would put a permanent gap in the invoice
sequence, which is precisely what the counter design exists to prevent. "One invoice per job" therefore
now means one *live* invoice — the finalize duplicate check, the Invoicer picker, Awaiting payments and
the Overview totals all ignore voided rows.

### Added — labour lines with per-line hours

The reworked template's second column is `HOUR(S)`, not `AMOUNT`. Labour is now a repeating two-column
table (description + hours); total hours are summed from the lines and multiplied by the rate, and the
euro figure appears only in the SUBTOTAL and TOTAL LABOUR boxes. A **Custom total** box overrides
hours × rate outright — and the hours still print, so the customer always sees the time spent
regardless of how the price was arrived at.

Hours are summed in hundredths via the existing money parser, so 0.1 + 0.2 is exactly 0.3.

### Fixed — two defects caught before they shipped

**The hours × rate divisor was wrong.** 3.5 h at €65 produced €2.28 instead of €227.50: hundredth-hours
times cents needs dividing by 100, not 10,000. Caught by an existing test that had been rewritten for the
new shape — the test suite earning its keep.

**Migration B would have failed halfway.** drizzle-kit generated the enum swap with a cast back to the
new type but no remap, so any row still holding `status = 'new'` would abort the migration *after* the
old type had already been dropped. Added an explicit `UPDATE ... SET status = 'active' WHERE status =
'new'` while the column is plain text.

### Fixed — the template could not be checked before publishing

The stamper loads the template from R2, not from disk, so the only way to see a revised template rendered
was to upload it to production first and look at the result there. That is backwards, and it showed
immediately: the first visual check rendered the *old* artwork and would have been passed as correct if
the header wording hadn't given it away. `INVOICE_ASSETS_LOCAL=1` now reads the assets straight off disk
for exactly this check. Production still fetches from R2.

### Verified — the new template needs no coordinate re-map

Both PDFs were text-extracted and compared field by field: every coordinate is identical, same 612×792
page. Only three labels changed (`SERVICES PERFORMED` → `WORK CARRIED OUT`, `AMOUNT` → `HOUR(S)`,
`TOTAL SERVICES` → `TOTAL LABOUR`), all at the same x/y. So `invoiceTemplateCoords.json` needed key
renames only, and the existing labour column lands exactly under the new header — what changed is its
meaning, not its position.

Row capacity was raised 5 → **6** for both tables and confirmed by rendering a full invoice to PNG and
looking at it: six rows sit clear of both subtotal bands, and a seventh would collide. Six is the honest
maximum, not an estimate.

### Changed — the rest

- **Registration leads the create form.** Entering a registration seen before offers the previous
  customer and vehicle for one-tap prefill, read from past jobs — no customer table, nothing to keep in
  sync.
- **Collapsible sections.** The form roughly doubled in length and ~90% of use is on a phone. Native
  `<details>`, so it works before hydration and gets keyboard and screen-reader behaviour free.
- **Two text fields, not three.** `internal_notes` is retired; **Work lines** print, **Notes** never do.
  Its contents are moved into `notes` in migration A, before the column is dropped in B.
- **Invoice filenames** now carry the customer and registration — the number alone means nothing in a
  WhatsApp thread. Non-ASCII is stripped because the value goes in a `Content-Disposition` header.
- **Row limits come from the template coordinates**, never hard-coded, so re-working the artwork changes
  them on its own.
- Physical column names still say `services_subtotal`/`total_services` while the code says labour: Drizzle
  maps the name, which gets coherent code with **zero migration risk on a live table** carrying issued
  invoices.

### Migration order (this mattered)

Additive columns had to exist before the new code ran, and the enum swap had to come after it, because
the old code still wrote `'new'`. Applied as two migrations either side of the deploy rather than one —
the single-migration version breaks job creation on a live site for the length of a deploy.

### Files Touched

- `lib/db/schema.ts` — job content columns, invoice snapshot/void columns, enum without `new`,
  `LabourLine`/`JobPartLine` types, Drizzle property renames
- `lib/money.ts` — labour lines, `sumLabourHours`, `formatHours`, the override, Labour renames
- `lib/pdf/{stamp,fieldKeys,invoiceTemplateCoords.json,assets}.ts` — `labourTable` with an `hours`
  column, totals renames, capacity 6, local-asset mode
- `lib/pdf/template/invoice-template.pdf` — the reworked template
- `lib/invoices/{build,fileName}.ts` — build from the job, snapshot helper, filename builder
- `app/api/invoices/{generate,finalize}/route.ts`, `app/api/invoices/[id]/{regenerate,void}/route.ts`
- `lib/db/queries/jobs.ts`, `lib/actions/jobs.ts` — void-aware queries, registration lookup
- `lib/validation/{common,job,invoice}.ts` — `jsonArray`, `optionalDecimal(String)`, job owns content
- `components/jobs/{job-form,line-editor,invoice-card}.tsx`, `components/invoicer/{invoicer,job-picker}.tsx`
- `app/(dashboard)/jobs/{new,[jobId]}/page.tsx`, `app/(dashboard)/invoicer/page.tsx`
- `app/api/export/{invoices,jobs}/route.ts` — Total labour, Voided at, no internal notes
- `drizzle/migrations/0001_grey_forgotten_one.sql`, `0002_flowery_ser_duncan.sql`
- `tests/labour.test.ts` (new), `tests/{money,validation}.test.ts`, `scripts/preview-invoice.ts`

## 15/08/2026 @ 22:33:34 IST — "claude-opus-5"

**Project completion: 99.02%**

Basis: 101 of 102 discrete build requirements. The DNS item closed this session — the custom domain
resolves, its certificate is issued, and the live site was re-verified end to end on it. The single
remaining item is the **optional** Zoho mailbox for `lee@nolanautomotive.ie`, which needs account
access rather than code. One thing sits outside that count and should not be read as closed: the
**GitHub repository is still public** and should be switched to private in the client's account.

### Goal

Confirm step 6 of the hosting runbook actually completed — that `dashboard.nolanautomotive.ie` serves
the real application, not just a DNS record — and prove the handover state is genuinely blank rather
than assumed to be.

### Verified — the domain is live

`dashboard.nolanautomotive.ie` resolves via CNAME to `cname.vercel-dns.com`, Vercel issued a Let's
Encrypt certificate (valid to 13/11/2026, renewed automatically), and the app serves over HTTPS.

Re-ran the critical paths against the real hostname rather than trusting the `.vercel.app` results,
because origin-sensitive things — cookies, CORS, certificates — are exactly what a domain change can
break:

- logged-out `/jobs` → 307 to `/login`; `POST /api/invoices/generate` → 401
- login succeeds, and the `nolan_session` cookie is `Secure` + `HttpOnly` on the real origin
- all seven pages load without error
- an invoice PDF generates end to end through the new hostname
- a photo uploads **straight from the browser to R2** and returns HTTP 200, which is the real proof
  the R2 CORS rule covers this origin — the bucket token is scoped to object read/write, so it cannot
  read the CORS config back, making an actual upload the only trustworthy check
- the stored photo opens through a signed R2 URL

### Fixed — a wrong instruction I had written into the README

The runbook told the reader that Vercel "now issues a project-specific target rather than the old
universal `cname.vercel-dns.com`". That was my own over-correction from an earlier session, and the
live DNS disproves it: this deployment resolves through the universal target and works. Reworded to
say either form is valid, copy whatever Vercel displays, and recorded which one is actually live —
so the next person reading it is not sent chasing a value that was never wrong.

### Confirmed — the handover state, proven rather than assumed

A verification run created a job that came back **J-0002**, not `J-0001`. Rather than assume a stale
starting state, the counters were read straight from the database: both were already at 1, so the
number came from residue at the start of that run, not from a numbering bug.

That is an inference, and "the owner's first job is number one" is too important to infer, so it was
tested directly: from the blank database a job was created on the live domain and came back
**J-0001**, then the factory reset was run and the database re-read.

The reset also turned out to have a property worth recording: it deletes uploaded files from R2 but
**leaves `_assets/` (the invoice template and the two fonts) untouched**. Had it wiped those, invoice
generation would have broken permanently and silently on the first reset the owner ever ran.

Final state, read from the database and R2 rather than from the UI: every table empty except the
settings singleton, `counters` at `invoice=1` / `job=1`, the attachments bucket empty, and the
invoices bucket holding only the three template assets.

### Files Touched

- `README.md` — step 6 marked done; corrected CNAME guidance; recorded what was verified live; fixed
  the anchor link broken by the heading rename
- `CHANGELOG.md` — this entry

## 15/08/2026 @ 20:06:59 IST — "claude-opus-5"

**Project completion: 98.04%**

Basis: 100 of 102 discrete build requirements. Five of the six previously-open deployment items are
now closed — Supabase project, R2 buckets, GitHub repo, Vercel deployment, and live end-to-end
verification. Scope grew by two (the schedule calendar and the navigation rework) and by one open
item (the optional Zoho mailbox). The two still open are **DNS at smarthost.ie** and that optional
mailbox, both of which need registrar/account access rather than code.

### Goal

Get the dashboard live, prove it works properly against real infrastructure, and hand it over blank
so the owner starts at job one and invoice one.

### Fixed — the bug that would have sunk it

**Every multi-query page hung in production.** Overview, Invoicer, Settings and Awaiting Payments all
timed out, while `/login`, the login API and `/api/health` returned 200 — which made it look like a
routing or auth fault rather than a database one.

The cause was mine. During the serverless hardening pass I set the connection pool to `max: 1`,
reasoning that "the pooler is the pool, so one connection is enough". That is wrong against Supavisor
in transaction mode: postgres.js pipelines concurrent queries down a single connection, and
transaction-mode pooling wants one transaction per connection, so they never complete. It does not
error, it **hangs** — which is exactly why single-query routes looked healthy while the Overview page
and its six parallel queries never returned.

Measured against the live database: `max: 1` exceeded 20s and never finished; `max: 5` did the same
six queries in 0.28s; `max: 8` was fastest on the widest page. Set to 8, with the reasoning recorded
in the file so it does not get "optimised" back by someone applying the same plausible instinct.
Overview went from a 45s hang to 2.0s.

### Added

**Schedule calendar** (`/schedule`) — a month view keyed on each job's due date, showing what is
booked, how loaded each day is, and which weekdays are still free to take work. Month grid from `md`
up, agenda list on phones. It also surfaces live jobs with **no** date, which are the ones that would
otherwise be invisible on a calendar and quietly forgotten.

Dates are handled as `YYYY-MM-DD` strings end to end, never as `Date` objects — the column is a bare
date, and converting through a `Date` applies a timezone offset that can move a booking to the day
before or after. For a garage that means a customer arriving on the wrong day. Tested against the
cases that break calendars: whole-week padding for all twelve months, leap and non-leap February,
year rollover both directions, and junk query params falling back to the current month.

**Navigation rebuilt into three surfaces.** A phone bottom bar with the five things touched between
jobs (Overview, Jobs, Schedule, Invoicer, Settings); a Menu drawer holding every page including the
two the bar has no room for; and a left rail from `lg` up that now collapses to icons, with the
choice remembered. The header was also trimmed from 59px to 43px — the Menu button carried a 44px
touch-target minimum that made it taller than everything beside it, and "Sign out" was wrapping to
two lines on a narrow screen.

### Changed

**Storage moved to Cloudflare R2, and the PDF template with it.** `lib/pdf/stamp.ts` used to read the
template and fonts from disk via `process.cwd()`. They now live in R2 and are fetched once per
isolate. This began as a Cloudflare requirement during a brief detour to Workers, and was kept after
returning to Vercel because it earned its place: the hosting target changed twice inside two days,
and an app that fetches its own assets from object storage moves with it for nothing. No
platform-specific build config, and ~1.2MB off the bundle.

Also: dark/light theme with system default and no flash on load; vehicle year/make/model as
dependent dropdowns with an "Other…" free-text escape hatch; and the guarded factory reset.

### Verification — 63 checks against the live site

All run in a real browser against `nolan-automotive-dashboard.vercel.app`, hitting the production
database and real R2. Not a staging copy.

- **Auth:** wrong password rejected, session cookie `Secure` + `httpOnly` + `SameSite=Strict`, logged
  out pages redirect and APIs 401.
- **Jobs:** created with full detail and every field read back from the database — apostrophe in
  "Margaret O'Sullivan" intact, registration upper-cased, multi-line address, VIN, make and model
  stored separately.
- **Editing:** a job was created and then extended afterwards ("customer rang back: also wants the
  timing belt and water pump done"), with mileage and status changed. All persisted.
- **Deletion:** a job was deleted and confirmed gone — and the invoice counter was **not** burned by
  it.
- **Invoicing:** three previews created no invoice and consumed no number; one send allocated
  `NA-2026-0001`, flipped the job to Invoiced and stored the PDF; the job then disappeared from the
  picker so it cannot be double-invoiced.
- **The PDF was downloaded from R2 and inspected**, not assumed: registration on the Model line,
  mileage `187,502`, description wrapped across rows, 2 × €61.25 = €122.50, totals €487.50 + €507.35
  + €0.00 = €994.85.
- **Money:** supplier bill recorded and cleared; invoice marked paid and cleared from Awaiting
  Payments; Overview totals tracked throughout; all three CSV exports download.
- **Mobile at 393px:** no horizontal overflow anywhere, 16px inputs so iOS will not zoom, theme
  persists, PWA assets publicly reachable.

### Handover state

The dashboard is **blank**. Every table is empty except the settings singleton; both counters are at
1, so the first job is `J-0001` and the first invoice `NA-2026-0001`. Login and business details are
preserved.

The reset was verified not to break anything: the three template assets in R2 survive it (they sit
under an `_assets/` prefix the reset never touches), and invoice generation was re-tested afterwards
— HTTP 200, `application/pdf`, 60,547 bytes, rendering correctly. Had those assets been deleted,
invoicing would have failed silently on the owner's first real use.

### Open

1. **DNS** — add a `dashboard` CNAME → `cname.vercel-dns.com` at smarthost.ie, and the domain in the
   Vercel project. Needs registrar access.
2. **Optional** — Zoho Mail free tier for `lee@nolanautomotive.ie`.
3. **Worth confirming after the first week:** that the daily Vercel cron against `/api/health` has
   actually run. It is what stops Supabase pausing the free project after ~7 idle days; if it
   silently stops, the dashboard goes down until someone clicks restore.

---

## 13/08/2026 @ 01:12:43 IST — "claude-opus-5"

**Project completion: 93.94%**

Basis: 93 of 99 discrete build requirements. Scope grew by 8 for deployment (R2 storage swap,
keep-alive cron, production migration runner, and five serverless-hardening fixes) and all 8 are
done. Note the percentage went *down* from 96.81% — that is honest rather than flattering: the
denominator grew because deployment turned out to need real code changes, not just configuration.
The 6 open items are all account work that cannot be done from here: create the client's Supabase
project, Cloudflare R2 buckets and GitHub repo, deploy to Vercel, point DNS, and verify live.

### Goal

Prepare the app to actually run on the internet at `dashboard.nolanautomotive.ie`, on a stack that
costs **€0/month** and lives entirely in client-owned accounts rather than the developer's personal
ones.

### Changed

**File storage moved from Supabase Storage to Cloudflare R2.** Supabase's free Storage is 1GB and —
the deciding factor — pauses along with the database project. R2 gives 10GB free with no egress
fees and stays up regardless. Supabase is now a plain managed Postgres host with nothing
proprietary left in the code; `@supabase/supabase-js` is gone entirely, which also means moving to
any other Postgres later is a connection-string change.

The subtle part is content-type: a presigned PUT is signed **for** a specific `Content-Type`, so the
browser must send exactly that header or R2 rejects it as a signature mismatch. `mimeType` is
therefore threaded from the client through the upload endpoint and is required rather than
optional — making it optional would produce uploads failing with an opaque 403.

Every exported function in `lib/storage/` kept its name and shape, so nothing outside that directory
changed beyond an import path.

### Added

**A daily keep-alive cron.** Supabase free pauses a project after ~7 idle days, which for a garage
that has had a quiet week means finding the dashboard down. `vercel.json` schedules a daily hit on
`/api/health`, which runs a `SELECT 1` — the query is the point, since a static 200 would satisfy
Vercel while letting Postgres go idle anyway. It requires `CRON_SECRET` as a bearer token (Vercel
Cron sends it automatically) and answers **404** rather than 401, so an unauthenticated caller
cannot even confirm the route exists. All three paths verified.

**A production migration runner** (`scripts/migrate.ts`) reading a gitignored
`.env.production.local`, so no production credential is typed into a shell or left in history. It
refuses `DIRECT_DATABASE_URL` pointing at port 6543 outright — the pooler breaks DDL *partway
through*, leaving a half-migrated database, so failing before starting is much better than
discovering it mid-run.

### Fixed — from a production-build audit

None of these would have shown up in `next dev`, `tsc --noEmit`, or the 96 passing tests.

**A missing admin credential failed silently and permanently.** `assertCredentialsConfigured()`
existed but nothing called it. With `ADMIN_USERNAME` or `ADMIN_PASSWORD` absent on Vercel, the site
would deploy looking completely healthy and reject every login with *"Incorrect username or
password"* — no error, no log, nothing in the build output. The natural response is to assume the
password is wrong and rotate it repeatedly. Worse, the test suite actively masked it: a passing test
asserts the guard throws, which reads as coverage for something never wired up. The login route now
calls it.

**The database client broke the build.** `lib/db/index.ts` threw at *module scope*, and
`force-dynamic` does not help — that governs rendering, not module evaluation, and `next build`
imports these modules to collect route config. The first casualty would likely have been a Preview
deployment where the variable was scoped to Production only.

Worth recording the trap: wrapping the connection in a `getSql()` function does **not** fix this,
because the call still runs at import. The laziness has to reach the export itself, so `db` is now a
`Proxy` resolving on first property access — all 13 import sites untouched. Verified in both
directions: imports cleanly with the variable absent, still throws a clear error when queried
without it.

**Connection pool sized for the wrong architecture.** `max: 10` per lambda instance would mean
hundreds of Supavisor clients under concurrency, past the free tier's limit. The pooler *is* the
pool; now `max: 1`.

**Function duration was unbounded.** Checked the real limit rather than assuming: Hobby is 300s
default **and** maximum under Fluid Compute. So `maxDuration = 60` on the invoice routes lowers a
ceiling rather than raising one — a hung database or storage call is cut off after a minute instead
of holding a slot for five. (The original plan assumed a 10s default and a timeout risk; that was
wrong, and the fix now serves the opposite purpose.)

**Node version undeclared.** `pdfjs-dist` needs `>=22.13.0`, a higher floor than Next 16's own
`>=20.9`, and pnpm only warns without an `engines` field. Pinned.

**File tracing missed a page.** `/invoicer` imports from `lib/pdf/stamp` but was not covered by
`outputFileTracingIncludes`. Safe today only because it calls `partsRowCapacity()`, which reads
bundled JSON — but the day anything there calls `stampInvoice`, it would `ENOENT` in production
while working perfectly in dev. Covered now, while the reason is understood.

**`/jobs/new` relied on inference** to be dynamic. Declared explicitly so its per-request auth check
does not depend on the layout's `cookies()` call opting the subtree out of static generation.

### Verification

`pnpm typecheck` clean, `pnpm lint` clean, 96 tests passing / 4 skipped. Against the live local
database: login accepted, wrong password 401, all six dashboard pages 200 with the lazy client in
play, health endpoint 200, CSV export valid. The health endpoint's secret was verified across all
three paths (no bearer → 404, wrong bearer → 404, correct → 200) and other API routes confirmed
still 401.

**Not yet verified: the R2 code itself.** It is ~100 lines whose first execution needs real buckets.
That happens locally against the client's real R2 — the CORS rule deliberately whitelists
`localhost:3000` — *before* anything ships, rather than discovering a signature or CORS mistake on
the client's live site.

### Files Touched

- `lib/storage/r2.ts` (new, replaces `supabaseAdmin.ts`), `lib/storage/signedUrl.ts`
- `app/api/attachments/upload-url/route.ts`, `components/jobs/attachment-manager.tsx`,
  `components/suppliers/bill-form.tsx` — thread `mimeType`
- `app/api/health/route.ts` (new), `vercel.json` (new), `proxy.ts`
- `scripts/migrate.ts` (new), `package.json` — prod scripts + `engines`
- `lib/db/index.ts` — lazy Proxy, `max: 1`
- `app/api/auth/login/route.ts` — call the credential guard
- `app/api/invoices/{generate,finalize}/route.ts` — `maxDuration`
- `app/(dashboard)/jobs/new/page.tsx` — `force-dynamic`
- `next.config.ts` — tracing for `/invoicer`
- `.env.example`, `README.md`

### Open / next session

All blocked on client-owned accounts, in this order:

1. **Cloudflare R2** — buckets, API token, CORS. Needed *first*, so the storage rewrite can be
   tested locally against real buckets.
2. **Supabase** — project in EU (Ireland), then `pnpm db:migrate:prod` and `pnpm db:seed:prod`.
3. **GitHub** — private repo under the client account, push.
4. **Vercel** — import, set env vars for Production *and* Preview, deploy, fix the first build.
5. **DNS** — `dashboard` CNAME → `cname.vercel-dns.com`.
6. Verify live, install to the owner's iPhone, then factory-reset the test data before handover.

---

## 13/08/2026 @ 00:31:39 IST — "claude-opus-5"

**Project completion: 96.81%**

Basis: 91 of 94 discrete build requirements. Scope grew by 3 (vehicle make/model/year pickers,
factory reset, and the free-text fallback for unlisted vehicles) and all 3 are done. The 3 still
open are unchanged and all require account access: create the hosted Supabase project and its two
Storage buckets, deploy to Vercel, and point `dashboard.nolanautomotive.ie` at it.

### Goal

Take typing away from the owner where the data is predictable, and give a safe way to wipe the test
data accumulated during development before the business starts using this for real.

### Added

**Year, make and model are now dropdowns.** Picking a make narrows the model list to that
manufacturer — choose Ford and you get Ford models, not a combined list. Selecting a model before a
make is impossible; the field reads "Select a make first" rather than showing an empty list. Years
run from next year (dealers pre-register plates) back to 1980.

- **Every make and model keeps an "Other…" escape hatch** that swaps in a free-text box. This is
  the part that matters: a garage will eventually see something not on any list, and a
  dropdown-only field would have blocked the job outright. It also means a job whose make was typed
  before these lists existed still opens and saves correctly instead of silently losing its value —
  the form detects an unlisted value and starts that field in free-text mode.
- Lists are Irish-market focused and include the vans a garage services as often as cars (Transit,
  Transporter, Sprinter, Trafic). `lib/vehicles.ts`, one line per model to extend.

**Factory reset, in Settings → Danger zone.** Clears every job, invoice, customer record, supplier,
bill and stored file, and restarts numbering at `J-0001` / `NA-<year>-0001`.

- Guarded three ways: the panel must be revealed, the exact phrase `RESET ALL DATA` typed, and that
  phrase re-checked **on the server** — the client prompt is a speed bump, not the control. Live row
  counts are shown before confirming so the owner sees exactly what is about to be destroyed.
- **Settings are deliberately preserved.** Business name, VAT registration and hourly rate are
  configuration, not data; wiping them would just mean retyping them.
- Deletion order is explicit rather than relying on cascades: `invoices` references `jobs` *without*
  ON DELETE CASCADE — deliberate, so an issued invoice can never be silently orphaned by deleting
  its job — which means invoices must be removed first.
- Storage objects are collected **before** the rows are deleted (afterwards the paths are gone) and
  removed best-effort afterwards, so one unreachable file cannot fail a reset whose rows are already
  committed.

> Flagged in both the UI and the README: this resets the invoice counter, so running it after real
> invoices have gone out would reissue numbers customers already hold and break the continuous
> sequence Revenue expects. It is a pre-launch tool.

### Fixed

- `RESET_CONFIRMATION_PHRASE` initially lived in the `'use server'` action file, where only async
  functions may be exported. Moved to `lib/validation/danger.ts` so the action and its UI share one
  definition.

### Verification

Driven through a real browser against the live local database:

- Model dropdown disabled until a make is chosen; Ford yields 27 models including Fiesta and
  excluding Corolla; switching to Toyota swaps the list and clears the stale selection.
- "Other…" swaps to a text input, and a saved custom vehicle (Piaggio Porter) **reopens in
  free-text mode on edit** — the legacy-data path works.
- Factory reset destroyed 2 jobs, 1 invoice, 1 supplier and 1 bill; counters returned to 1;
  **settings survived** (business name, phone and VAT rate all intact). The confirm button stayed
  disabled for an empty phrase and for `reset all data` in the wrong case.
- `pnpm typecheck` clean, `pnpm lint` clean, **96 tests passing / 4 skipped** (13 new covering the
  vehicle data and year range).

### Files Touched

- `lib/vehicles.ts` (new) — makes, models, year range, known-value checks
- `components/jobs/vehicle-fields.tsx` (new) — dependent dropdowns with free-text fallback
- `components/jobs/job-form.tsx` — swapped four text inputs for the picker
- `lib/actions/danger.ts` (new) — factory reset
- `lib/validation/danger.ts` (new) — shared confirmation phrase
- `components/settings/factory-reset.tsx` (new) — danger-zone UI
- `lib/db/queries/overview.ts` — `getResetCounts()`
- `lib/storage/signedUrl.ts` — best-effort `removeObjects()`
- `app/(dashboard)/settings/page.tsx` — danger zone wired in
- `tests/vehicles.test.ts` (new), `README.md`

---

## 12/08/2026 @ 22:24:36 IST — "claude-opus-5"

**Project completion: 95.60%**

Basis: 87 of 91 discrete build requirements. The scope grew by 4 items this session (PWA install,
mobile navigation, mobile input/viewport handling, mobile PDF preview) and all 4 are done, plus the
tax-rate placement fix. Also newly resolved: the app now runs verified end-to-end against a real
PostgreSQL database, which closes 2 of the 6 previously-open deployment items (migrations applied,
end-to-end verification with real data). The 4 still open are all Supabase/Vercel/DNS account work:
create the hosted Supabase project, create the two Storage buckets, deploy to Vercel, and point
`dashboard.nolanautomotive.ie` at it.

### Goal

Run the app for real on localhost, fix what that exposed, and make it a properly installable,
phone-first PWA — the owner will use it from a home-screen icon on a phone for most of the work.

### Fixed

**Tax rate was printed in the wrong column.** The number sat immediately left of the template's
pre-printed `%`, leaving it stranded mid-row. The `%` actually behaves like the `€` symbol — a
prefix label in a fixed column — so the value belongs right-aligned in the same column as the money
figures, directly beneath the subtotal. Both tax-rate fields moved from `x:462 w:28` to `x:505
w:62`, matching their subtotals exactly. Verified by rendering and cropping the totals block.

### Added

**Installable PWA.** `app/manifest.ts` (standalone display, brand theme colour, 192/512/maskable
icons), an icon set generated with ImageMagick from the project's own bundled Noto Sans Bold, and
the iOS metadata that actually matters — `apple-touch-icon`, `apple-mobile-web-app-title` and a
translucent status bar.

- The manifest and `/icons/**` had to be **removed from the auth gate**. A browser fetches them
  before any session exists; behind the gate they 307 to `/login`, the install prompt silently never
  appears, and iOS uses a screenshot as the home-screen icon. Verified: both return 200 with no
  cookie while `/jobs` still returns 307.
- Next emits the standardised `mobile-web-app-capable`, which only Safari 15.4+ honours. The
  Apple-prefixed original is added explicitly so an older iPhone still launches standalone rather
  than inside a Safari tab.

**Phone-first layout.** Navigation became a fixed bottom tab bar on phones (thumb reach) with the
left rail only from `md` up; `viewport-fit=cover` plus `env(safe-area-inset-*)` padding keeps
content clear of the notch and home indicator in standalone mode.

- **Form controls are now 16px on phones.** Safari zooms the viewport when a focused input is
  smaller than that and never zooms back out. Controls return to 14px from `sm` up. Verified
  computed font-size is 16px at a 393px viewport.
- **The invoice preview no longer relies on an embed on phones.** iOS Safari cannot render a PDF
  inside `<object>`/`<iframe>` — it renders a blank box. Phones get an explicit "Open invoice
  preview" action that hands the PDF to the system viewer; the embed is used from `md` up. This
  would have looked like a broken feature on the owner's primary device.
- The sticky send bar now sits above the tab bar rather than behind it, and primary buttons clear
  44px on phones.

### Verification

Run against **real PostgreSQL 16** (local Homebrew instance, `nolan_dashboard`), migrations applied
and seeded, driven through a real Chrome via CDP:

- Login accepted; wrong password rejected 401; all seven authenticated routes return 200.
- Created **J-0001** through the UI — job-number allocation works against a real counter row.
- Generated and sent an invoice: **NA-2026-0001** written, job flipped to `invoiced`, both counters
  advanced to 2, `sent_via` recorded. Totals correct (€280 services + €148 parts, VAT 0 because the
  business is not VAT registered = €428).
- **The duplicate-invoice guard added last session was confirmed working under real conditions**: a
  second finalize on the same job returned 400 with a clear message, the invoice count stayed at 1,
  and the counter was *not* burned — the rollback released the number, exactly as designed.
- **The storage-failure path was exercised for real.** No Supabase runs locally, so the upload
  genuinely failed; the invoice still committed, the PDF still came back, and the Invoicer showed
  the warning rather than a 500. That fix earned its keep on its first outing.
- CSV exports return valid UTF-8 BOM CSV with quoting intact, including an address containing a
  newline.
- Mobile at a 393px viewport: no horizontal overflow, tab bar correctly placed, 16px inputs, send
  bar clearing the nav, and a second job (**J-0002**) created and invoiced entirely on the phone
  layout. No console or page errors on any screen.
- `pnpm typecheck` clean, `pnpm lint` clean, 83 tests passing / 4 skipped.

### Files Touched

- `lib/pdf/invoiceTemplateCoords.json` — tax-rate column alignment
- `app/manifest.ts` (new), `app/layout.tsx` — PWA manifest, iOS metadata, viewport
- `public/icons/*` (new) — 192, 512, maskable 512, apple-touch 180, favicon
- `proxy.ts` — manifest and icons excluded from the auth gate
- `app/globals.css` — safe-area utilities, 16px control rule, momentum scrolling
- `components/layout/sidebar.tsx` — split into `MobileNav` (bottom tabs) and `Sidebar` (rail)
- `app/(dashboard)/layout.tsx` — tab-bar clearance, safe-area header
- `components/ui/index.tsx` — 16px controls, larger touch targets
- `components/invoicer/{invoicer,send-bar}.tsx` — mobile PDF action, send-bar offset
- `README.md` — "Mobile and installing to a phone"

### Open / next session

1. Create the hosted Supabase project (EU/Frankfurt) and the two private Storage buckets, then
   re-test attachment upload and invoice PDF storage against real infrastructure.
2. Deploy to Vercel; confirm `TEMPLATE_MAPPER` is unset there.
3. Add the `dashboard` CNAME → `cname.vercel-dns.com`.
4. Install to an actual iPhone home screen and confirm standalone launch and the icon.
5. Run the counter concurrency tests with `TEST_DATABASE_URL`.

---

## 12/08/2026 @ 21:42:33 IST — "claude-opus-5"

**Project completion: 93.10%**

Basis: unchanged at 81 of 87 discrete build requirements — this entry fixes defects in already-built
functionality rather than adding scope. The same 6 deployment-chain items remain open (Supabase
project, migration against a real database, Storage buckets, Vercel deploy, DNS, end-to-end
verification with real data).

### Goal

Close two defects found reviewing the finalize path. Neither was reachable by the checks run
previously — one needs a page refresh to trigger, the other needs an infrastructure failure.

### Fixed

**A job could be invoiced twice, consuming two invoice numbers.** The only server-side guard was
`job.status === 'paid'`, but finalising sets a job to `invoiced`, not `paid` — and the Invoicer
picker deliberately offers every non-paid job. The client locked its own form after finalising, so
in normal use nothing went wrong, but that lock was the *only* thing preventing a repeat: a page
refresh, a second tab, a retry after a flaky connection, or a double submit racing past the pending
flag would each produce a second invoice on the same job, with a second number burned. Since one
job with two live invoices is exactly the data-integrity failure the numbering design exists to
prevent, this was worth fixing properly rather than tightening the client.

Fix: `finalize` now takes `SELECT … FOR UPDATE` on the job row as the first statement in its
transaction, then checks for an existing invoice before allocating. Locking is what makes it
race-safe — a plain check outside the lock races with itself, and two concurrent calls would both
pass it. Jobs that already have an invoice are also filtered out of the picker so the situation is
not normally reachable, but the transaction is the authoritative guard. Documented in the README,
including where to relax it if credit notes are ever needed.

**A storage failure after commit surfaced as an opaque 500, hiding the invoice.** The commit-then-
upload ordering is deliberate (a recorded invoice with a missing file is recoverable; an orphaned
file nobody knows about is not), but there was no handling for the upload actually failing. The
invoice row and the consumed number were already committed, yet the owner would have seen only a
500 — no PDF returned, so they could not even send the invoice they had just created, and the job
page would later show a broken PDF link with no explanation.

Fix: the upload is caught separately. The generated PDF is returned either way, with an
`X-Storage-Failed` header, and the Invoicer states plainly that the invoice exists but the stored
copy is missing so it should be downloaded now.

### Changed

- `/api/invoices/[id]/pdf` uses `NextResponse.redirect` instead of the bare Web `Response.redirect`,
  which is stricter about cross-origin targets from a Route Handler — the redirect points at a
  Supabase signed URL and cannot be exercised locally without a real bucket.

### Verification

`pnpm typecheck` clean, `pnpm lint` clean, 83 tests passing / 4 skipped. The duplicate-invoice guard
is not covered by an automated test: like the counter concurrency tests it needs a real Postgres to
mean anything, and it is listed in the README's next-session checks.

### Files Touched

- `app/api/invoices/finalize/route.ts` — job row lock, duplicate guard, upload failure handling
- `app/api/invoices/[id]/pdf/route.ts` — `NextResponse.redirect`
- `lib/db/queries/jobs.ts` — exclude already-invoiced jobs from `listInvoiceableJobs()`
- `components/invoicer/invoicer.tsx` — surface the storage-failure warning
- `README.md` — "One invoice per job" and "If storing the PDF fails"

---

## 12/08/2026 @ 21:34:55 IST — "claude-opus-5"

**Project completion: 93.10%**

Basis: 81 of 87 discrete build requirements resolved, counted against the MVP specification
(auth 5, route gating 3, overview 4, jobs 7, attachments 4, invoicer 12, send/share 5, invoice
records 4, awaiting payments 3, suppliers 5, settings 6, template mapper 4, data model 7,
security/GDPR 6, deliverables 6 = 81 complete). The 6 open items are the deployment chain, all of
which need account credentials this session does not have: create the Supabase project, run the
migration against a real database, create the two Storage buckets, deploy to Vercel, point
`dashboard.nolanautomotive.ie` at it, and verify end-to-end with real data. Every one is documented
step by step in the README. The application code itself is complete and verified locally
(`pnpm typecheck`, `pnpm lint`, 83 tests, and a visually inspected generated invoice).

### Goal

Build the Nolan Automotive internal back-office dashboard from scratch: manage jobs, generate
invoices onto the business's existing PDF template without altering it, track money owed by
customers and money owed to suppliers. Single owner, cheap to host, sensible about the customer
personal data it holds.

The whole project is greenfield — the target directory was empty. Two sibling directories
(`GMS-inventory-mgmt`, `main-website`) were checked for reusable code and explicitly ruled out on
the user's instruction; they turned out to be empty or unrelated AI-generated prototypes with no
job, invoice, PDF or Supabase logic, and were not under version control.

### Added

**PDF invoice engine — the core of the build.** The supplied template is loaded as an immutable
background and text is stamped onto it at coordinates from `lib/pdf/invoiceTemplateCoords.json`.
The invoice is never rebuilt as HTML.

- *Why coordinate stamping at all:* the template has **zero AcroForm fields** (verified with
  pdf-lib), so there is nothing to fill — drawing at measured coordinates is the only option that
  preserves the artwork exactly.
- *Why an embedded TrueType font:* pdf-lib's built-in Helvetica is WinAnsi-encoded and **throws**
  on any character outside CP1252. Irish fadas happen to be inside it, but Polish and Baltic
  customer names — entirely plausible in Ireland — are not, so a customer name could have crashed
  invoice generation in production. Noto Sans (OFL, redistributable) is embedded via `fontkit` with
  subsetting, which adds only ~5KB to the output. Verified by stamping `Łukasz Ó Súilleabháin —
  "brake job" €1,234.56 žŠ` and rendering the result.
- *Why one `drawStampText()` wrapper:* it is the only function that draws, so the pure-black rule
  cannot be forgotten at a call site.
- Coordinates were derived by extracting the real positions of the pre-printed labels from the
  PDF's content stream with pdf.js, not estimated by eye.

**Three template findings that contradicted the brief**, each resolved in favour of template
fidelity because "must look EXACTLY like the template" is the more emphatic requirement:

1. *The template is US Letter (612×792pt), not A4.* Measured, not assumed. Rescaling to A4 would
   visibly distort the artwork, so output matches the template. `assertPageGeometry()` now fails
   loudly if the template is ever re-exported at a different size, rather than letting every
   coordinate silently shift.
2. *Two fields are stamped white.* The `INVOICE # / DATE` banner is a dark charcoal bar with white
   pre-printed labels; black text there is invisible. Confirmed by cropping and inspecting the
   rendered bar. Only `invoiceNumber` and `issueDate` deviate, colour is a per-field property in
   the coords JSON, and the user approved this explicitly.
3. *Registration, VIN, customer email and VAT number have no blank on the template.* All are still
   captured. The VAT number is prefixed into Other Comments (an invoice legally needs it) and, at
   the user's direction, the registration is appended to the Model line via `buildModelLine()`.

**Fixed during the build — a genuine overflow bug.** Appending the registration made the Model line
wrap onto a second line and collide with the Colour row. Cause: single-line fields sitting on
pre-printed rules had no `maxHeight`, so `fitTextInBox` was free to wrap instead of shrink. Fix:
every such field now carries a one-line `maxHeight`, so long values shrink to fit. Verified by
re-rendering and inspecting the vehicle block. This is exactly the "never overflow" requirement,
and it would have shipped unnoticed without a visual check.

**Two-phase invoicing, so the invoice sequence has no gaps.** `POST /api/invoices/generate` stamps
a preview with a provisional number and writes nothing; `POST /api/invoices/finalize` allocates the
number, inserts the invoice and flips the job to Invoiced in a single transaction, then re-stamps
with the number actually allocated before uploading. Allocating at preview time would burn a number
on every abandoned preview, which is precisely the gap Revenue does not want to see. `finalize` has
no `[id]` in its path because it creates the invoice.

- Numbering is `NA-YYYY-0001`, continuous, never reset in January (user decision). Allocation is a
  single `UPDATE … RETURNING` that takes a row lock, inside the caller's transaction. A Postgres
  `SEQUENCE` was deliberately rejected: sequences are non-transactional and burn values on
  rollback, creating the exact gaps the design must avoid.

**Send/share flow with its platform limits handled honestly.** No web API can pre-attach a file to
a specific WhatsApp chat, so the Web Share API is the primary path (real file handed to the OS
share sheet) with a download + prefilled `mailto:`/`wa.me` fallback. Email carries the bright
"Recommended" pill the user asked for.

- Sending is deliberately **two taps**: `navigator.share()` must be called synchronously inside a
  user gesture, and finalising is an awaited fetch that ends that gesture. Sharing the preview first
  and finalising after would be one tap but could send a customer a PDF whose number differs from
  the one recorded. Correctness won.

**Auth, verified rather than assumed.** Single admin from env vars, stateless `jose` JWT cookie
(`httpOnly`, `sameSite=strict`, `secure` in production), gated in `proxy.ts` plus a defence-in-depth
check in the dashboard layout and in every sensitive route handler.

- `jose` rather than `jsonwebtoken` because the gate runs on the Edge runtime, which has no Node
  `crypto`.
- Credentials are compared by hashing both sides to a fixed-width SHA-256 digest first, because
  `timingSafeEqual` **throws** on buffers of unequal length — comparing raw strings would have
  crashed on nearly every failed login. There is a test for exactly that input.
- Verified live: `/jobs` → 307 to `/login`, `POST /api/invoices/generate` → 401 JSON, `/login` → 200.

**Migrated `middleware.ts` → `proxy.ts`.** Next.js 16 deprecated the `middleware` file convention;
the dev server flagged it. Renamed to the current convention rather than shipping a deprecation
warning on a brand-new project.

**Everything else:** Drizzle schema (7 tables) + migration + idempotent seed; Overview with KPI and
money cards; Jobs list/search/filter/detail with attachments; Awaiting Payments with manual
mark-as-paid; Suppliers with bills and totals; Settings with VAT and three CSV exports; and the
Template Mapper dev tool (canvas + pdf.js, tagged from a closed field-key picklist shared with the
stamper, gated behind `TEMPLATE_MAPPER`).

- Uploads go **browser → Supabase Storage directly** via a signed upload URL. Vercel caps a
  serverless body at ~4.5MB and a phone photo exceeds that, so proxying would have failed on exactly
  the files the owner most wants to attach.
- All euro arithmetic is integer cents in `lib/money.ts`. Drizzle returns `numeric` columns as
  JavaScript **strings**; multiplying those directly produces silent garbage.
- CSV exports neutralise spreadsheet formula injection, since they contain free text the owner typed.

### Changed

- **Drizzle instead of Prisma**, per the user's standing preference, overriding the literal spec.
- **No component library.** The brief asks for a plain internal tool; `components/ui` is ~15 styled
  native elements with no client JS, keeping most pages as Server Components. `react-hook-form` and
  `@hookform/resolvers` were installed, went unused, and were removed rather than left as dead
  dependencies.
- **Jobs store `vehicleMake` and `vehicleModel` separately** rather than one combined field, because
  the template prints Make and Model on separate lines.
- **Invoices have no `status` column.** A row exists only once sent, so a status enum with one value
  would carry no information.
- **`.gitignore`** amended so `.env*` no longer excludes `.env.example`, which must be tracked.

### Verification

- `pnpm typecheck` — clean.
- `pnpm lint` — clean. One real finding fixed along the way: `setState` inside an effect for Web
  Share capability detection, replaced with a derived `useMemo` (it is a pure query).
- `pnpm test:run` — **83 passing, 4 skipped.** The skipped four are the invoice-counter concurrency
  tests, which need a real Postgres (`TEST_DATABASE_URL`); a mock cannot demonstrate a row-locking
  guarantee, so they are skipped rather than faked.
- `pnpm invoice:preview` — a deliberately awkward sample invoice (long description, full parts
  table, accented name, multi-line address) rendered to PNG and **visually inspected**. Totals
  independently checked: labour 3.5 × €65 = €227.50, parts €248.05, VAT 23% = €109.38, total
  €584.93.
- `pnpm build` was **not** run, per the 8GB-RAM constraint in the global rules.

### Files Touched

New project, 83 source files. The ones that matter:

- `lib/pdf/` — `stamp.ts` (engine), `textFit.ts` (wrap/shrink, pure and unit-tested), `coords.ts`
  (contract + geometry assertion), `fieldKeys.ts` (closed key set shared by mapper and stamper),
  `invoiceTemplateCoords.json`, `template/invoice-template.pdf`, `fonts/` (Noto Sans + OFL licence)
- `lib/counters.ts` — atomic allocator for invoice and job numbers
- `lib/money.ts` — all euro arithmetic, integer cents
- `lib/db/` — `schema.ts`, `index.ts` (pooled client, `prepare: false`), `queries/`
- `lib/auth/` — `session.ts`, `credentials.ts`, `constants.ts`, `require-session.ts`
- `lib/invoices/build.ts` — shared by generate and finalize so the two cannot drift
- `lib/storage/`, `lib/actions/`, `lib/validation/`, `lib/csv.ts`, `lib/format.ts`, `lib/utils.ts`
- `proxy.ts` — the single auth gate
- `app/(auth)/login/`, `app/(dashboard)/{page,jobs,invoicer,awaiting-payments,suppliers,settings,dev}`
- `app/api/{auth,invoices,attachments,export,dev}/`
- `components/{ui,layout,auth,jobs,invoicer,suppliers,settings,payments,dev}/`
- `drizzle/migrations/0000_organic_stardust.sql`, `drizzle/seed.ts`
- `tests/` — 6 suites
- `scripts/preview-invoice.ts`, `README.md`, `.env.example`, `drizzle.config.ts`,
  `next.config.ts` (output file tracing for the template and fonts), `vitest.config.mts`

### Open / next session

1. Create the Supabase project (EU/Frankfurt), the two private buckets, then `pnpm db:migrate` and
   `pnpm db:seed`.
2. Deploy to Vercel and add the environment variables — confirm `TEMPLATE_MAPPER` is unset there.
3. Add the `dashboard` CNAME → `cname.vercel-dns.com` at the registrar for `nolanautomotive.ie`.
4. Run the counter concurrency tests against the real database with `TEST_DATABASE_URL`.
5. Generate one real invoice and check it by eye before sending it to a customer.
6. Decide the Vercel Hobby-vs-Pro question — the free tier is licensed for non-commercial use.
