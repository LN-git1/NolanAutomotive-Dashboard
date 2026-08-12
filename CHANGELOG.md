# Changelog

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
