# Nolan Automotive — Internal Dashboard

Single-user back-office dashboard for a small Irish mechanics business: manage jobs, generate
invoices onto the business's existing PDF template, track money owed by customers and money owed
to suppliers.

Live at **https://nolan-automotive-dashboard.vercel.app** — moving to
**https://dashboard.nolanautomotive.ie** once DNS is pointed (step 6 below).

---

## Hosting runbook

The whole hosting setup, in order. All six steps are **done** — the dashboard is live at
<https://dashboard.nolanautomotive.ie>.

| # | Step | Status |
|---|---|---|
| 1 | Supabase project (Postgres) | ✅ done |
| 2 | Cloudflare R2 (file storage) | ✅ done |
| 3 | GitHub repository | ✅ done |
| 4 | Vercel project + environment variables | ✅ done |
| 5 | Database migrate, seed, and publish PDF assets | ✅ done |
| 6 | Point the domain | ✅ done |

### 1. Supabase — the database

Create a project in an **EU region**. Then Project Settings → Database → Connection string, and take
**both**:

| Which | Port | Goes into |
|---|---|---|
| Transaction pooler | 6543 | `DATABASE_URL` — append `?pgbouncer=true` |
| Session pooler | 5432 | `DIRECT_DATABASE_URL` |

Skip the "Direct connection" option — it is IPv6-only without a paid add-on.

> The database password is set at project creation and is **not recoverable**. If it is lost, reset it
> under **Database → Settings → Reset database password** (not Project Settings — it moved).

### 2. Cloudflare R2 — file storage

R2 → enable (a card is required on file even on the free tier; nothing bills under 10GB). Create two
**private** buckets: `nolan-attachments` and `nolan-invoices`.

Then on the R2 overview page, **Account Details → API Tokens → Manage → Create Account API token**,
with permission **Object Read & Write** scoped to those two buckets. Copy the Access Key ID and
Secret Access Key immediately — the secret is shown once.

**Set CORS on `nolan-attachments`**, or every upload fails with an opaque browser error:

```json
[{
  "AllowedOrigins": ["https://dashboard.nolanautomotive.ie", "http://localhost:3000"],
  "AllowedMethods": ["PUT", "GET"],
  "AllowedHeaders": ["content-type"],
  "MaxAgeSeconds": 3600
}]
```

### 3. GitHub

A **private** repository. Push `main`. Confirm no `.env*` file is present except `.env.example`.

### 4. Vercel

Import the repository. Framework preset Next.js; leave build and install commands at their defaults
(pnpm is detected from the lockfile). Add every variable from
[Environment variables](#environment-variables) for **Production, Preview and Development** — all
three, because `DATABASE_URL` is read at build time and a Production-only scope breaks preview
builds. Do **not** add `TEMPLATE_MAPPER`.

### 5. Initialise the data

Run these locally against production, reading `.env.production.local`:

```bash
pnpm db:migrate:prod    # creates the 7 tables
pnpm db:seed:prod       # settings singleton + the two counters — REQUIRED
pnpm assets:upload      # publishes the invoice template and fonts to R2 — REQUIRED
```

All three are mandatory. Without the seed, creating a job or invoice throws. Without the assets,
invoice generation fails because the template is fetched from R2 at runtime rather than read from
disk.

### 6. Point the domain

DNS for `nolanautomotive.ie` is hosted at **Cloudflare** (nameservers `jack`/`lara.ns.cloudflare.com`),
delegated there from smarthost.ie. Records are added in Cloudflare, not at the registrar.

**Do these in order — Vercel first.**

**a.** Vercel → **the project** → **Settings → Domains** → **Add Domain** →
`dashboard.nolanautomotive.ie`. Direct path: `vercel.com/<team>/<project>/settings/domains`. Note it
is *project* settings; team settings has no Domains entry.

**b.** Vercel then displays the CNAME target to use. Copy the value it shows rather than assuming
one: newer projects are sometimes given a project-specific target (e.g.
`d1d4fc829fe7bc7c.vercel-dns-017.com`) instead of the universal `cname.vercel-dns.com`. Either is
valid — **this deployment resolves through the universal `cname.vercel-dns.com`**, which is what is
live in Cloudflare today.

**c.** Cloudflare → `nolanautomotive.ie` → **DNS → Records → Add record**:

| Field | Value |
|---|---|
| Type | `CNAME` |
| Name | `dashboard` |
| Target | **the value Vercel displayed in step b** |
| Proxy status | **DNS only** (grey cloud, not orange) |
| TTL | Auto |

The grey cloud matters. Proxied (orange) means Cloudflare terminates TLS itself, Vercel cannot
validate the domain to issue its certificate, and the result is usually a redirect loop or a
certificate error.

**d.** Wait for Vercel to verify and issue the TLS certificate automatically. Confirm with:

```bash
dig dashboard.nolanautomotive.ie CNAME +short
curl -I https://dashboard.nolanautomotive.ie/login
```

Propagation is usually minutes, but can take up to 24–48 hours depending on the registrar's TTL. The
apex `nolanautomotive.ie` is untouched and stays free for the main website.

**Verified live on 15/08/2026:** CNAME resolves to `cname.vercel-dns.com`, Let's Encrypt certificate
issued (valid to 13/11/2026 and renewed automatically), `/login` returns 200, logged-out `/jobs`
redirects to `/login`, `POST /api/invoices/generate` returns 401, the session cookie is `Secure` +
`HttpOnly`, and a photo uploads straight from this origin to R2 (so the CORS rule in step 2 covers the
live domain).

### Deploying changes afterwards

```bash
pnpm typecheck && pnpm lint && pnpm test:run
git push                      # Vercel builds and deploys automatically
```

Only if the database schema changed:

```bash
pnpm db:generate              # locally, commit the generated SQL
pnpm db:migrate:prod          # AFTER the deploy succeeds
```

Never run `pnpm build` locally — see the warning under [Quick start](#quick-start).

---

## Contents

- [Stack](#stack)
- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Supabase setup](#supabase-setup)
- [Cloudflare R2 setup](#cloudflare-r2-setup)
- [Deploying to Vercel](#deploying-to-vercel)
- [DNS: pointing dashboard.nolanautomotive.ie](#dns-pointing-dashboardnolanautomotiveie)
- [How invoicing works](#how-invoicing-works)
- [Email / WhatsApp attachment limitations](#email--whatsapp-attachment-limitations)
- [The Template Mapper](#the-template-mapper)
- [Template deviations](#template-deviations)
- [Security and GDPR notes](#security-and-gdpr-notes)
- [Testing](#testing)
- [Project structure](#project-structure)

Work considered and deliberately deferred lives in **[ROADMAP.md](ROADMAP.md)** — including the
arrival-date / due-back-to-customer change, which is fully designed but not built.

---

## Stack

| Concern | Choice |
|---|---|
| Framework | Next.js 16 (App Router) + TypeScript |
| Styling | Tailwind CSS v4, light and dark themes |
| UI | Hand-rolled primitives in `components/ui` — no component library |
| Database | PostgreSQL via Supabase (EU region) — used as a managed Postgres host only |
| ORM | Drizzle |
| File storage | Cloudflare R2 (S3-compatible), two **private** buckets |
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
#    ADMIN_USERNAME, ADMIN_PASSWORD, and the R2_* credentials

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
| `R2_ACCOUNT_ID` | yes | Cloudflare account ID. |
| `R2_ACCESS_KEY_ID` | yes | **Server only.** |
| `R2_SECRET_ACCESS_KEY` | yes | **Server only.** Full read/write on both buckets. |
| `R2_ATTACHMENTS_BUCKET` | yes | Default `nolan-attachments`. |
| `R2_INVOICES_BUCKET` | yes | Default `nolan-invoices`. |
| `CRON_SECRET` | prod | Bearer token for the daily keep-alive cron. |
| `TEMPLATE_MAPPER` | no | `true` enables the mapper locally. **Must be unset in production.** |

> **No variable here may be prefixed `NEXT_PUBLIC_`.** That prefix inlines the value into the client
> bundle at *build* time — it would both leak the credential and read as "not set" at runtime even
> when the runtime environment has it.

Set every variable for **Production and Preview** in Vercel. `DATABASE_URL` in particular is read
during the build, so scoping it to Production only makes Preview deployments fail.

### Why two database URLs

Supabase's pooler runs in transaction mode, handing each statement a different backend connection.
That breaks the prepared statements migrations rely on, so `drizzle-kit` uses `DIRECT_DATABASE_URL`.
Conversely, serverless functions need the pooler, and `lib/db/index.ts` passes `prepare: false` for
the same reason. Mixing these up produces confusing "prepared statement already exists" errors.

---

## Supabase setup

Supabase is used **only as a managed Postgres host** — not for storage, not for auth. Nothing
proprietary to it appears in the code, so moving to any other Postgres is a connection-string change.

1. Create a project in an **EU region** (Ireland, `eu-west-1`) — customer personal data should stay
   in the EU.
2. Project Settings → Database → copy both connection strings:
   - **Pooled** (port `6543`) → `DATABASE_URL`, and append `?pgbouncer=true`
   - **Direct** (port `5432`) → `DIRECT_DATABASE_URL`
3. Run `pnpm db:migrate` then `pnpm db:seed`.

### The free tier pauses — and why that is handled

Supabase pauses a free project after roughly a week of inactivity, which for a garage that has had a
quiet week would mean finding the dashboard down and needing a manual restore.

`vercel.json` schedules a daily cron against `/api/health`, which runs a `SELECT 1`. The query is the
point — a static 200 would satisfy Vercel while letting Postgres go idle anyway. After deploying,
check **Vercel → Project → Cron Jobs** at least once to confirm it actually ran; if that cron ever
stops, the pause problem comes back silently.

---

## Cloudflare R2 setup

Chosen over Supabase Storage because the free tier is 10GB rather than 1GB, egress is free, and —
critically — it does not pause with the database project.

1. Cloudflare account → R2 → enable it. **A payment method is required on file even for the free
   tier**; nothing is charged below 10GB.
2. Create two buckets, both **private** (no public access, no custom domain):
   - `nolan-attachments` — job photos/receipts and supplier bill receipts
   - `nolan-invoices` — finalised invoice PDFs
3. Create an **R2 API token** scoped to *Object Read & Write* on those two buckets only. Record the
   Account ID, Access Key ID and Secret Access Key.
4. **Set CORS on `nolan-attachments`.** The browser PUTs directly to R2, so without this every upload
   fails with an opaque CORS error:
   ```json
   [{
     "AllowedOrigins": ["https://dashboard.nolanautomotive.ie", "http://localhost:3000"],
     "AllowedMethods": ["PUT", "GET"],
     "AllowedHeaders": ["content-type"],
     "MaxAgeSeconds": 3600
   }]
   ```
   The `localhost` entry is deliberate — it lets the upload path be tested locally against the real
   buckets rather than first exercising it on the live site.

Nothing is ever served from a public URL. The browser only receives short-lived presigned URLs minted
server-side (120s to view, 900s to download, 300s to upload).

> **Content-Type is part of the signature.** A presigned PUT is signed for one specific
> `Content-Type`, and the browser must send exactly that header or R2 rejects it. This is why the
> upload-url endpoint requires `mimeType` from the client rather than guessing it.

---

## Deploying to Vercel

1. Push the repository, then import it in Vercel.
2. Add every variable from the table above, for **Production and Preview**. Mark
   `R2_SECRET_ACCESS_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD`, `CRON_SECRET` and both database URLs
   as **Sensitive**.
3. Confirm `TEMPLATE_MAPPER` is **not set**. The mapper writes a file into the source tree, which a
   serverless filesystem cannot do.
4. Deploy.

### After the first deploy

- Run `pnpm db:migrate:prod` then `pnpm db:seed:prod`. **The seed is not optional** — without the
  settings singleton and the two counter rows, creating a job or an invoice throws.
- In the build log's route summary, confirm `/jobs/new` shows `ƒ` (Dynamic), not `○` (Static).

> **⚠️ The repository must stay PUBLIC while the project is on Vercel Hobby.**
>
> Hobby does not support collaboration on **private** repositories. If the repo is made private,
> Vercel blocks any deployment whose **commit author** is not the Vercel account owner
> (`lnautomotive2025-8997`) — commits authored by the developer's own GitHub account are refused with
> *"the commit author did not have contributing access"*.
>
> This is easy to misread: GitHub reports it as a **failed** build, but nothing was ever built. The
> deployment status description is `Deployment was blocked`, and the site keeps serving the previous
> build, so the only symptom is that changes silently stop shipping. Check with:
>
> ```bash
> gh api repos/LN-git1/NolanAutomotive-Dashboard/commits/$(git rev-parse HEAD)/status --jq '.state'
> gh api "repos/LN-git1/NolanAutomotive-Dashboard/deployments?sha=$(git rev-parse HEAD)" --jq '.[0].id' \
>   | xargs -I{} gh api repos/LN-git1/NolanAutomotive-Dashboard/deployments/{}/statuses --jq '.[0].description'
> ```
>
> To make the repo private and keep automatic deploys, one of these has to be true:
> commits are authored by the client's own GitHub identity (the Vercel account owner), or the Vercel
> project moves to **Pro**. Verified the hard way on 16/08/2026. No secrets are in the repository —
> every `.env*` is gitignored — so public costs nothing but visibility.

> **Licensing caveat, accepted knowingly.** Vercel's free **Hobby** tier is licensed for
> non-commercial use, and a dashboard running a business's day-to-day operations is commercial use.
> This deployment uses Hobby anyway: a single-user internal tool is the least likely thing to be
> enforced against, and the fallback is upgrading to Pro or migrating — not a data-loss event.
> Recorded here so the decision is visible rather than buried.

---

## DNS: pointing dashboard.nolanautomotive.ie

See [step 6 of the hosting runbook](#6-point-the-domain).

In short: the domain is registered at smarthost.ie but its DNS is delegated to **Cloudflare**, so
records are added in Cloudflare. Add the domain in Vercel first to obtain the CNAME target it wants,
then create that record with the proxy set to **DNS only**.

---

## Mobile and installing to a phone

The dashboard is built phone-first — most of the work happens on a phone in the workshop, not at a
desk. It is an installable PWA.

### Installing

**iPhone / iPad (Safari):** open the site → Share → **Add to Home Screen**. It then launches
full-screen with no browser chrome, its own icon and its own app switcher entry.

**Android (Chrome):** open the site → menu → **Install app** (or accept the install prompt).

> The manifest (`/manifest.webmanifest`) and everything under `/icons` are deliberately **outside
> the auth gate** in `proxy.ts`. A browser fetches them before any session exists — if they
> redirected to `/login`, the install prompt would silently never appear and iOS would fall back to
> a screenshot as the home-screen icon. Neither exposes anything beyond the app's name and logo.

### What was done for mobile specifically

| Concern | Handling |
|---|---|
| Navigation | A fixed **bottom tab bar** on phones, within thumb reach; the left rail only appears from `md` up. |
| iOS zoom-on-focus | Every form control is **16px** on phones. Safari zooms the viewport when a focused input is smaller and never zooms back out — this is the single most common mobile-web annoyance. Controls drop to 14px from `sm` up, where the behaviour does not apply. |
| Notch and home indicator | `viewport-fit=cover` plus `env(safe-area-inset-*)` padding on the header and the tab bar, so nothing sits under the status bar or the home indicator in standalone mode. |
| PDF preview | iOS Safari **cannot render a PDF inside `<object>`/`<iframe>`** — it shows a blank box. Phones therefore get an explicit "Open invoice preview" action that hands the file to the system PDF viewer; the inline embed is used from `md` up. |
| Send bar | Sticks above the tab bar (`bottom-[calc(4rem+safe-area)]`) rather than behind it. |
| Touch targets | Primary buttons are ≥44px tall on phones. |
| Tables | Scroll horizontally inside their own container with momentum scrolling; the page body never scrolls sideways. |
| Phone-number autolinking | Disabled, so registrations, mileages and job numbers are not turned into tap-to-call links. |

Sharing an invoice is also **better** on a phone than on a desktop: the Web Share API can hand
WhatsApp or Mail the actual PDF, which desktop browsers largely cannot do.

---

## Entering a vehicle

Year, make and model are dropdowns, not text fields — the model list narrows to the make you pick,
so a Ford shows Ford models and nothing else. Choosing a model before a make is not possible; the
field says "Select a make first" rather than presenting an empty list.

Every make and model also offers **"Other…"**, which swaps in a free-text box. This matters: a
garage will eventually see something not on any list, and a dropdown-only field would block the job
outright. The same mechanism means a job whose make was typed before these lists existed still
opens and saves correctly instead of silently losing its value.

The lists live in `lib/vehicles.ts` and cover the Irish market, including the vans a garage services
as often as cars (Transit, Transporter, Sprinter, Trafic and so on). Adding a model is a one-line
edit to that file.

---

## Resetting the dashboard

**Settings → Danger zone → Reset all data** clears every job, invoice, customer record, supplier,
bill and uploaded file, and restarts job and invoice numbering at `J-0001` / `NA-<year>-0001`.

It is guarded three ways: the panel has to be revealed, an exact phrase (`RESET ALL DATA`) has to be
typed, and that phrase is re-checked on the server — the client prompt is a speed bump, not the
control. The current row counts are shown before you confirm, so you can see exactly what is about
to be destroyed.

> ⚠️ **Only use this to clear test data before going live.** It resets the invoice counter, so
> running it after real invoices have gone out would reissue numbers customers already hold, which
> breaks the continuous sequence Revenue expects. There is no undo.

Your business details, VAT settings and default hourly rate are **kept** — those are configuration,
not data.

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
- **Uploads bypass the app server** — the browser PUTs straight to Cloudflare R2 using a presigned
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
  storage/                   R2 client · presigned URLs
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
