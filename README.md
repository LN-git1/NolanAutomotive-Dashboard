# Nolan Automotive — Internal Dashboard

Single-user back-office dashboard for a small Irish mechanics business: manage jobs, generate
invoices onto the business's existing PDF template, track money owed by customers and money owed
to suppliers.

Intended to run at **https://dashboard.nolanautomotive.ie**.

---

## Contents

- [Stack](#stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Deploying to Vercel](#deploying-to-vercel)
- [DNS: pointing dashboard.nolanautomotive.ie](#dns-pointing-dashboardnolanautomotiveie)
- [How invoicing works](#how-invoicing-works)
- [Email / WhatsApp attachment limitations](#email--whatsapp-attachment-limitations)
- [The Template Mapper](#the-template-mapper)
- [Template deviations](#template-deviations)
- [Security and GDPR notes](#security-and-gdpr-notes)
- [Testing](#testing)
- [Project structure](#project-structure)

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4, single light theme |
| UI | Hand-rolled primitives in `components/ui` — no component library |
| Database | PostgreSQL via Supabase (EU region) |
| ORM | Drizzle |
| File storage | Supabase Storage, two **private** buckets |
| PDF | `pdf-lib` + `@pdf-lib/fontkit`, coordinate stamping onto the supplied template |
| Auth | Single admin from env vars, stateless JWT session cookie (`jose`) |
| Hosting | Vercel |

> **Why no component library?** The brief asks for a plain, non-flashy internal tool. Everything in
> `components/ui` is a styled native element with no client-side JavaScript, which keeps most of the
> dashboard renderable as Server Components.

---

## Quick start

```bash
pnpm install

# 1. Configure the environment
cp .env.example .env.local
#    then fill in DATABASE_URL, DIRECT_DATABASE_URL, SESSION_SECRET,
#    ADMIN_USERNAME, ADMIN_PASSWORD, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# 2. Create the tables and the rows the app cannot start without
pnpm db:migrate
pnpm db:seed          # settings singleton + the invoice/job counters — REQUIRED

# 3. Run
pnpm dev
```

### Everyday commands

| Command | What it does |
|---|---|
| `pnpm dev` | Development server |
| `pnpm typecheck` | **Primary verification.** Must be zero errors |
| `pnpm lint` | ESLint |
| `pnpm test:run` | Vitest suite, once |
| `pnpm db:generate` | Generate a migration after changing `lib/db/schema.ts` |
| `pnpm db:migrate` | Apply migrations (uses the DIRECT connection) |
| `pnpm db:seed` | Idempotent — safe to re-run, never resets the counter |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm invoice:preview` | Render a sample invoice to `/tmp/nolan-invoice-preview.pdf` |
| `pnpm mapper` | Dev server with the Template Mapper enabled |

> ⚠️ **Do not run `pnpm build` on the development machine.** It is memory-hungry and will lock up an
> 8GB machine. Use `pnpm typecheck` as the verification gate; Vercel does the real build.

---

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `ADMIN_USERNAME` | yes | The only account. There is no user table. |
| `ADMIN_PASSWORD` | yes | Compared in constant time. Never hardcoded. |
| `SESSION_SECRET` | yes | ≥32 chars. Signs the session cookie — a secret, not a credential. `openssl rand -base64 32` |
| `DATABASE_URL` | yes | **Pooled** connection, port `6543`, must include `?pgbouncer=true`. Runtime queries. |
| `DIRECT_DATABASE_URL` | yes | **Direct** connection, port `5432`. Migrations and seeding only. |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Project URL. Safe to expose. |
| `SUPABASE_SERVICE_ROLE_KEY` | yes | **Server only.** Bypasses row-level security — never prefix with `NEXT_PUBLIC_`. |
| `TEMPLATE_MAPPER` | no | `true` enables the mapper locally. **Must be unset in production.** |

### Why two database URLs

Supabase's pooler runs in transaction mode, handing each statement a different backend connection.
That breaks the prepared statements migrations rely on, so `drizzle-kit` uses `DIRECT_DATABASE_URL`.
Conversely, serverless functions need the pooler, and `lib/db/index.ts` passes `prepare: false` for
the same reason. Mixing these up produces confusing "prepared statement already exists" errors.

---

## Supabase setup

1. Create a project in an **EU region** (Frankfurt) — customer personal data should stay in the EU.
2. Storage → create two buckets, both with **Public access disabled**:
   - `attachments` — job photos/receipts and supplier bill receipts
   - `invoices` — finalised invoice PDFs
3. Project Settings → Database → copy both the pooled (6543) and direct (5432) connection strings.
4. Project Settings → API → copy the project URL and the **service_role** key.
5. Run `pnpm db:migrate` then `pnpm db:seed`.

Nothing is ever served from a public URL. The browser only ever receives short-lived signed URLs
minted server-side (120s to view, 900s to download).

---

## Deploying to Vercel

1. Push the repository, then import it in Vercel.
2. Add every variable from the table above. Mark `SUPABASE_SERVICE_ROLE_KEY`, `SESSION_SECRET` and
   `ADMIN_PASSWORD` as **Sensitive**.
3. Confirm `TEMPLATE_MAPPER` is **not set**. The mapper writes a file into the source tree, which a
   serverless filesystem cannot do.
4. Deploy.

> **Licensing caveat — please decide before going live.** Vercel's free **Hobby** tier is licensed
> for non-commercial use. A dashboard running a for-profit business's day-to-day operations is
> commercial use, so this most likely requires **Vercel Pro (~$20/month)** to be within Vercel's
> terms. This is flagged, not worked around.

---

## DNS: pointing dashboard.nolanautomotive.ie

Only the apex domain `nolanautomotive.ie` has been purchased; the subdomain does not exist yet.

1. Sign in to the registrar that holds `nolanautomotive.ie` and open its **DNS management** panel.
   (`.ie` domains are sold through IEDR-accredited registrars, so the exact screen varies.)
2. Add a record:
   - **Type:** `CNAME`
   - **Host / Name:** `dashboard`
   - **Value / Target:** `cname.vercel-dns.com`
   - **TTL:** default (or 3600)
3. In Vercel → Project → **Settings → Domains**, add `dashboard.nolanautomotive.ie`.
4. Wait for Vercel to verify the domain and issue the TLS certificate automatically.
5. Verify propagation:
   ```bash
   dig dashboard.nolanautomotive.ie CNAME +short
   ```

Propagation is usually minutes but can take up to 24–48 hours depending on the registrar's TTL.
The apex `nolanautomotive.ie` is untouched by this and remains free for the main website.

---

## How invoicing works

The invoice is **never rebuilt as HTML**. The supplied PDF is loaded as an immutable background and
text is drawn on top of it at coordinates from `lib/pdf/invoiceTemplateCoords.json`.

### Two phases: previewing is free, sending commits

| Phase | Endpoint | Effect |
|---|---|---|
| **Generate** | `POST /api/invoices/generate` | Stamps a preview using a *provisional* number. **Writes nothing.** No invoice number is consumed. |
| **Finalize** | `POST /api/invoices/finalize` | One transaction: allocate the number → insert the invoice → set the job to `invoiced`. Then re-stamps with the number actually allocated, uploads it, and returns those exact bytes. |

This split exists because the invoice sequence must have **no gaps** — Revenue expects a continuous
run. If a number were allocated at preview time, every abandoned preview would burn one.

`finalize` has no `[id]` in its path because it *creates* the invoice; there is nothing to address
until it has run.

### One invoice per job

A job can be invoiced **once**. Jobs that already have an invoice disappear from the Invoicer
picker, and `finalize` refuses them outright — it locks the job row and re-checks inside the
transaction, so a double submit, a retry or a second browser tab cannot slip two invoices (and two
consumed numbers) onto the same job. To re-send an existing invoice, open the job and use the PDF
link; that does not create anything new.

If credit notes or corrective invoices are ever needed, that guard in
`app/api/invoices/finalize/route.ts` is the single place to relax — deliberately, and with a plan
for how the second document is numbered.

### If storing the PDF fails

The invoice is committed before the PDF is uploaded, so a storage outage cannot leave a file with
no record of it. If the upload does fail, the endpoint still returns the generated PDF along with an
`X-Storage-Failed` header, and the Invoicer tells the owner plainly that the invoice exists but the
stored copy is missing — so they can download and send it immediately rather than meeting an opaque
error on an invoice number that has already been consumed.

### Invoice numbering

Format `NA-YYYY-0001`. The year segment reflects the year of issue, but the numeric segment is
**continuous and never resets in January**.

Allocation is a single `UPDATE … RETURNING` against a `counters` row, which takes a row-level lock,
so concurrent callers serialise and can never receive the same number. It runs inside the same
transaction as the insert, so a failure rolls the number back rather than leaving a gap.

> A Postgres `SEQUENCE` was deliberately **not** used: sequences are non-transactional and burn
> values on rollback, which is exactly the gap the design has to avoid.

### VAT

Driven entirely by Settings. When *VAT registered* is off, the rate and every tax amount are forced
to zero. All money arithmetic lives in `lib/money.ts` and is done in integer cents — Drizzle returns
`numeric` columns as JavaScript **strings**, and multiplying those directly yields silent garbage.

---

## Email / WhatsApp attachment limitations

**No web technology can pre-attach a file to a specific WhatsApp conversation.** A `wa.me` link can
pre-fill message text only. This is a platform restriction, not an implementation shortcut.

What is implemented instead:

1. **Primary — Web Share API.** The generated PDF is handed to the operating system share sheet as a
   real file, so WhatsApp, Gmail, Outlook, Mail and anything else installed appear as targets with
   the invoice already attached. The owner still picks the recipient inside the chosen app. Works on
   iOS and Android; support on desktop browsers is limited.
2. **Fallback — download + pre-filled link.** Where file sharing is unavailable (typically desktop),
   the PDF downloads and either `mailto:` or `wa.me` opens with the message body pre-filled. The
   owner attaches the downloaded file manually.

Message body in both cases:

```
Please see attached invoice.

Nolan Automotive
```

### Why sending takes two taps

`navigator.share()` must be called **synchronously inside a user gesture**. Finalising the invoice is
an awaited network call, which ends that gesture — so on iOS Safari a single tap cannot both commit
the invoice and open the share sheet.

The flow is therefore deliberate:

1. **First tap** (Email / WhatsApp / ⋮) — creates the invoice and marks the job Invoiced.
2. **Second tap** — a fresh gesture, so the share sheet opens with the authoritative PDF.

Sharing the preview on the first tap and finalising afterwards would be one tap, but the customer
could receive a PDF showing a different number from the one recorded. Correctness wins.

**Email carries a "Recommended" badge** because it is the most reliable route end to end.

Because finalising happens on the first tap, the invoice exists even if the share sheet is then
cancelled. That is intentional and harmless — the PDF is already stored and can be re-shared from
the job at any time without creating a second invoice.

---

## The Template Mapper

A development-only tool for setting the stamping coordinates.

```bash
pnpm mapper       # TEMPLATE_MAPPER=true next dev
# then open /dev/template-mapper
```

- Renders the template to a `<canvas>` with pdf.js. A native PDF viewer is unusable for this: it
  adds its own chrome and zoom, so a click inside it cannot be converted to a reliable coordinate.
- Drag a box over a blank, then tag it with **what data belongs there**, chosen from a fixed
  picklist — not free text. That picklist and the stamping engine both read
  `lib/pdf/fieldKeys.ts`, so it is impossible to map a field the stamper does not understand.
- Saving writes `lib/pdf/invoiceTemplateCoords.json`, which is committed like any other source file.
- Verify a change with `pnpm invoice:preview`, which renders a deliberately awkward sample invoice
  (long description, full parts table, accented name, multi-line address).

Repeating rows (the services and parts tables) are **geometry**, not individual boxes: each is
defined once as a start position, a row height, a maximum row count and per-column widths. Row *n*
sits at `startY − n × rowHeight`. Edit those directly in the JSON under `rowTemplates`.

Fields absent from the JSON are simply not stamped — that is the intended escape hatch for data the
template has no blank for.

---

## Template deviations

Three findings from the supplied template that the brief did not anticipate. All are deliberate and
none modify the template artwork.

### 1. The template is US Letter, not A4

Measured from the file: **612 × 792pt** (A4 would be 595.28 × 841.89). The brief asked for A4 output,
but the template is the immutable artefact and rescaling it to A4 would visibly distort the artwork —
which the brief forbids far more emphatically. Output therefore matches the template exactly.
`lib/pdf/stamp.ts` asserts the page size on every render, so a re-exported template fails loudly
instead of silently shifting every coordinate.

### 2. Two fields are stamped white, not black

The brief says all stamped text must be pure black. The `INVOICE #` / `DATE` banner is a dark
charcoal bar whose pre-printed labels are white — black text there is effectively invisible.

Only `invoiceNumber` and `issueDate` are mapped as white. Everything else is pure black, enforced
centrally: every draw call in `lib/pdf/stamp.ts` goes through one `drawStampText()` wrapper, so no
call site can forget it. The colour is a per-field property in the coordinates JSON, so this can be
reverted from the Template Mapper without touching code.

### 3. Some data has no blank on the template

The template has no field for **vehicle registration**, **VIN**, **customer email** or a **VAT
number**. These are still captured and stored; they are simply not mapped by default, so nothing
unlabelled floats on the page.

- **VAT number** is the exception: when the business is VAT registered it is prefixed into the
  *Other Comments* block as `VAT No: …`, since an invoice legally needs it. Assembled in
  `lib/pdf/stamp.ts:buildCommentsBlock`.
- **Registration** is worth deciding on: an Irish garage invoice normally shows it. Map it anywhere
  you like with the Template Mapper, or leave it off.

Separately, the template prints **Make** and **Model** on separate lines, so jobs store
`vehicleMake` and `vehicleModel` as separate columns rather than one combined field.

---

## Security and GDPR notes

- **Everything is gated.** `proxy.ts` (Next.js 16's renamed `middleware`) covers every page *and*
  every `/api/**` route. Pages redirect to `/login`; API routes return `401` JSON.
- **Defence in depth.** `app/(dashboard)/layout.tsx` re-checks the session, and every sensitive route
  handler calls `requireApiSession()`. If the matcher were ever mis-edited, data still is not served.
- **Session cookie:** `httpOnly`, `sameSite=strict`, `secure` in production, 7-day expiry.
- **Credentials:** compared by hashing both sides to a fixed-width SHA-256 digest and then using
  `timingSafeEqual`. Comparing raw strings would *throw* on nearly every failed login, because
  `timingSafeEqual` rejects buffers of differing length.
- **Files:** both buckets private; access only via short-lived signed URLs generated with the
  service-role key server-side. That key never reaches the browser (`server-only` makes an accidental
  client import a build error).
- **Uploads bypass the app server** — the browser PUTs straight to Supabase Storage using a signed
  upload URL. Vercel caps a serverless request body at roughly 4.5MB, which a phone photo exceeds.
- **Input validation:** every mutation is validated with Zod on the server. Browser `required`
  attributes are convenience only.
- **Destructive actions are confirmed**, and jobs are **soft-deleted** — a job may be referenced by
  an issued invoice, which must stay reconstructable for tax purposes.
- **CSV exports** guard against spreadsheet formula injection (`=`, `+`, `-`, `@`), because the
  exports contain free text the owner typed.
- **The dashboard is `noindex, nofollow`.**

### Suggested hardening beyond this MVP

- Store `ADMIN_PASSWORD_HASH` (bcrypt) instead of the plaintext password, so the password never sits
  in the Vercel environment UI.
- Rate-limit the login route. This needs external state (e.g. Upstash Redis) because serverless
  functions are stateless per invocation.
- A documented retention policy for customer data and attachments.

---

## Testing

```bash
pnpm test:run
```

Covers the logic where a silent bug would be expensive:

| Area | Why it is tested |
|---|---|
| `lib/pdf/textFit.ts` | The "never overflow" guarantee. Includes a word wider than its box (the infinite-loop case) and text that still will not fit at the minimum size. |
| `lib/money.ts` | VAT and rounding correctness; the VAT-disabled path forcing zero. |
| `lib/auth/*` | Includes a wrong password of a **different length** — the exact input that crashes a naive `timingSafeEqual`. |
| `lib/validation/*` | Data-shape regressions. |
| `lib/csv.ts` | Formula-injection neutralisation. |
| `lib/counters.ts` | Number formatting always; **concurrency against a real Postgres** when `TEST_DATABASE_URL` is set. |

The concurrency test is skipped unless you point it at a throwaway database, because the guarantee
comes from Postgres row locking and a mock cannot demonstrate it:

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres pnpm test:run
```

Deliberately **not** automated: pixel-diffing generated PDFs (use `pnpm invoice:preview` and look at
it), and the share/`mailto:`/`wa.me` flows, which depend on OS share sheets and installed apps.
Check those by hand on desktop Chrome, desktop Safari, iOS Safari and Android Chrome.

---

## Project structure

```
app/
  (auth)/login/              Public. The only ungated page.
  (dashboard)/               Everything else — session required
    page.tsx                 Overview
    jobs/                    List, new, detail
    invoicer/                Invoice generation
    awaiting-payments/       Invoiced-but-unpaid
    suppliers/               Suppliers and bills
    settings/                Business details, VAT, exports
    dev/template-mapper/     TEMPLATE_MAPPER only
  api/
    auth/                    login (Node runtime), logout
    invoices/                generate (preview) · finalize (commit) · [id]/pdf
    attachments/             upload-url · [id]/signed-url
    export/                  jobs · invoices · supplier-bills (CSV)
    dev/                     template-pdf · template-coords (TEMPLATE_MAPPER only)

lib/
  auth/                      session (jose, Edge-safe) · credentials · guards
  db/                        schema · client · queries/
  actions/                   Server Actions — all mutations
  pdf/                       stamp · textFit · coords · fieldKeys · template/ · fonts/
  invoices/build.ts          Shared by generate and finalize so they cannot drift
  storage/                   Supabase admin client · signed URLs
  counters.ts                Atomic allocator for invoice and job numbers
  money.ts                   All euro arithmetic, integer cents
  validation/                Zod schemas

proxy.ts                     The single auth gate (Next.js 16 renamed `middleware`)
drizzle/                     Migrations + seed
tests/                       Vitest
```

### Conventions

- **Server Actions for every mutation.** Route Handlers only where the response must be binary or
  needs custom headers: PDF generate/finalize, CSV, signed URLs, auth cookies.
- **All job reads go through `lib/db/queries/jobs.ts`**, which is the single place the
  `deletedAt IS NULL` filter is applied.
- **All euro arithmetic goes through `lib/money.ts`.** Never inline VAT maths.
