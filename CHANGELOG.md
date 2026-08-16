# Changelog

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
