# New Job Import (Screenshot / Markdown / Voice) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clicking "New job" opens a choice modal — Create from scratch (unchanged), or import from a screenshot, a markdown file, or a voice recording — where the three import paths parse unstructured input into job fields via OpenRouter and land the owner on the existing job form, pre-filled, for review before saving.

**Architecture:** One shared extraction pipeline (`lib/import/`) builds an OpenRouter chat-completion request per kind (plain text for markdown, an `image_url` block for screenshot, an `input_audio` block for voice), validates the response against a lenient Zod schema, and normalizes it into a prefill object. Screenshot/voice bytes go browser→R2 directly (bypassing Vercel's body-size limit) via a new import-scoped upload route; the parse route reads them back server-side with the S3 SDK, never through the Vercel request body. `JobForm` gets a `sessionStorage`-based prefill handoff that reuses its existing registration-lookup remount mechanism.

**Tech Stack:** Next.js 16.3.0 (App Router, Node runtime for the new routes), Drizzle ORM over postgres-js, Postgres (Supabase), Zod v4, Tailwind, Vitest, `@aws-sdk/client-s3` (already installed) — no new npm dependency for OpenRouter itself, plain `fetch`.

## Global Constraints

- **Never run `pnpm build`** — 8GB RAM machine, it locks up. `pnpm typecheck` is the primary verification.
- **Never reset the database.** Accumulating test rows is explicitly fine; the rate-limit table this plan adds is real production infrastructure, not test data — don't delete it casually.
- All money/quantity arithmetic in this codebase uses integer cents / decimal strings via `lib/money.ts` and the `optionalDecimalString`/`decimalString` helpers in `lib/validation/common.ts` — never multiply a Drizzle `numeric` string as a float.
- `components/ui/index.tsx` has no `'use client'` by design. Never add a client-only component to that barrel — the new modal lives in `components/jobs/`.
- **The extraction schema must never include `status`, `hourlyRate`, or `labourTotalOverride`.** `createJob` runs `jobInputSchema.safeParse` with no guard against a hallucinated `status: 'paid'` (that guard, `changeJobStatus`'s refusal, only exists on the edit path) — an import that produced `paid` would create a job with no `payments` row behind it, silently invisible to Earnings. The model is never given the option.
- API routes (`app/api/**/route.ts`) use `requireApiSession()` from `@/lib/auth/require-session` (returns `Response | null`, `if (denied) return denied;`). Server actions (`'use server'` files) use the sibling `requireSession()` (redirects, no return value). Do not mix these up.
- `OPENROUTER_API_KEY` is a new required env var — add to `.env.example`, never commit a real value.
- Tests requiring a real database follow `describe.skipIf(!TEST_DATABASE_URL)`, run with `TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run`.
- No RTL/Playwright in this repo — anything requiring a rendered `JobForm` or the modal's live DOM is manual-only, called out explicitly per task.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/db/schema.ts` | **Modify.** Add `importKindEnum`, `importParseAttempts` table. |
| `lib/import/rate-limit.ts` | **Create.** `admitParseAttempt` — atomic admit-or-reject check. |
| `lib/import/schema.ts` | **Create.** `ImportKind`, `extractedJobSchema`, `ExtractedJob`. |
| `lib/import/openrouter.ts` | **Create.** `extractJsonObject`, `callOpenRouter`, model config. |
| `lib/vehicles.ts` | **Modify.** Add `normaliseMake`, `normaliseModel`. |
| `lib/import/prompt.ts` | **Create.** `buildExtractionPrompt`, `buildMessages`, `mapMimeToOpenRouterFormat`. |
| `lib/import/map.ts` | **Create.** `ImportPrefill`, `mapExtractedToPrefill`, `isPrefillEmpty`. |
| `lib/storage/signedUrl.ts` | **Modify.** Add `buildImportPath`, `fetchObjectBytes`. |
| `app/api/import/upload-url/route.ts` | **Create.** Presigned upload URL for import files. |
| `app/api/import/parse/route.ts` | **Create.** The endpoint that calls OpenRouter. |
| `components/jobs/job-form.tsx` | **Modify.** Read + apply the stashed prefill. |
| `components/jobs/new-job-modal.tsx` | **Create.** `NewJobButton` — choice modal + capture UI. |
| `app/(dashboard)/jobs/page.tsx` | **Modify.** Swap in `NewJobButton`. |
| `app/(dashboard)/schedule/page.tsx` | **Modify.** Swap in `NewJobButton`. |
| `.env.example` | **Modify.** Add `OPENROUTER_API_KEY`. |

---

## Task 1: Rate-limit table and admit function

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `lib/import/rate-limit.ts`
- Test: `tests/import-rate-limit.test.ts`

**Interfaces:**
- Consumes: `DbOrTx` type from `lib/counters.ts`.
- Produces: `admitParseAttempt(database: DbOrTx, kind: ImportKind): Promise<boolean>`. Callers elsewhere pass the real `db` from `@/lib/db`; tests pass their own connection, exactly like `allocateNumber`.

- [ ] **Step 1: Add the schema**

In `lib/db/schema.ts`, add near the other `pgEnum`/table declarations (after `counterKeyEnum`/`counters` is a natural spot):

```ts
export const importKindEnum = pgEnum('import_kind', ['screenshot', 'markdown', 'voice']);

/**
 * One row per attempted import parse (admitted attempts only — see
 * `admitParseAttempt`, which never logs a rejected one). Backs a simple
 * sliding-window rate limit on the OpenRouter-calling parse route: this app
 * has session auth only (no public signup), so the abuse surface is narrow,
 * but a client bug or a leaked session token shouldn't be able to run up
 * unbounded API cost. `kind` is kept for observability, not separate buckets.
 */
export const importParseAttempts = pgTable(
  'import_parse_attempts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    kind: importKindEnum('kind').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('import_parse_attempts_created_at_idx').on(table.createdAt)],
);

export type ImportParseAttempt = typeof importParseAttempts.$inferSelect;
```

- [ ] **Step 2: Generate and apply the migration**

```bash
pnpm db:generate
```

Expected: a new file under `drizzle/migrations/`. Read it to confirm it creates the `import_kind` enum and the `import_parse_attempts` table with the expected columns/index — nothing else.

```bash
set -a && source .env.local && set +a && pnpm db:migrate
```

Expected: `[✓] migrations applied successfully!`. (`drizzle-kit migrate` needs `DIRECT_DATABASE_URL`, which a bare invocation does not auto-load — always source `.env.local` first.)

- [ ] **Step 3: Write the failing rate-limit test**

Create `tests/import-rate-limit.test.ts`, mirroring `tests/counters.test.ts`'s real-database pattern exactly:

```ts
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { admitParseAttempt } from '@/lib/import/rate-limit';
import * as schema from '@/lib/db/schema';

/**
 * The property that matters is concurrency-safety and the "rejected attempts
 * aren't logged" guarantee — neither is demonstrable with a mock, so this runs
 * against a real throwaway Postgres, same as `allocateNumber`'s tests.
 *
 *   TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run
 */
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)('admitParseAttempt (requires TEST_DATABASE_URL)', () => {
  let client: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    client = postgres(TEST_DATABASE_URL!, { prepare: false, max: 20 });
    db = drizzle(client, { schema });
  });

  afterAll(async () => {
    await client?.end();
  });

  afterEach(async () => {
    await db.execute(sql`DELETE FROM import_parse_attempts`);
  });

  it('admits an attempt and logs exactly one row', async () => {
    const admitted = await admitParseAttempt(db, 'markdown');
    expect(admitted).toBe(true);

    const rows = await db.execute(sql`SELECT * FROM import_parse_attempts`);
    expect((rows as unknown as unknown[]).length).toBe(1);
  });

  it('admits exactly the 10-per-10-minute limit under concurrency, rejects the rest, and logs nothing for a rejection', async () => {
    const CONCURRENT = 15;

    const results = await Promise.all(
      Array.from({ length: CONCURRENT }, () => admitParseAttempt(db, 'screenshot')),
    );

    const admittedCount = results.filter(Boolean).length;
    expect(admittedCount).toBe(10);

    const rows = await db.execute(sql`SELECT * FROM import_parse_attempts`);
    // Rejected attempts are never inserted — logged rows equal admitted count exactly.
    expect((rows as unknown as unknown[]).length).toBe(10);
  });

  it('rejects once the daily cap is hit, independent of the 10-minute window', async () => {
    // Seed 60 attempts spread across the last day but outside the 10-minute
    // window, so only the daily cap is being exercised.
    await db.execute(sql`
      INSERT INTO import_parse_attempts (kind, created_at)
      SELECT 'voice', now() - interval '1 hour' - (n || ' seconds')::interval
      FROM generate_series(1, 60) AS n
    `);

    const admitted = await admitParseAttempt(db, 'markdown');
    expect(admitted).toBe(false);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run tests/import-rate-limit.test.ts 2>&1 | tail -30
```

Expected: FAIL — `admitParseAttempt` does not exist yet.

- [ ] **Step 5: Implement `admitParseAttempt`**

Create `lib/import/rate-limit.ts`:

```ts
import 'server-only';

import { sql } from 'drizzle-orm';

import type { DbOrTx } from '@/lib/counters';
import type { ImportKind } from './schema';

/**
 * Atomically admit-or-reject one import parse attempt, logging it only when
 * admitted. `INSERT ... SELECT ... WHERE (...)` means the whole check-and-log
 * happens in one round trip: if either window is already at its cap, the
 * SELECT yields no rows, nothing is inserted, and RETURNING is empty — so a
 * client retrying past the limit can never dig itself deeper by triggering
 * another log entry on the rejected call.
 *
 * Global across all three kinds by design for v1 — `kind` is kept only for
 * observability. Thresholds (10/10min, 60/day) are a starting default for a
 * single-owner garage's realistic usage, not a tuned final value.
 */
export async function admitParseAttempt(database: DbOrTx, kind: ImportKind): Promise<boolean> {
  const result = await database.execute(sql`
    INSERT INTO import_parse_attempts (kind)
    SELECT ${kind}
     WHERE (SELECT count(*) FROM import_parse_attempts WHERE created_at > now() - interval '10 minutes') < 10
       AND (SELECT count(*) FROM import_parse_attempts WHERE created_at > now() - interval '1 day') < 60
    RETURNING id
  `);

  return (result as unknown as unknown[]).length > 0;
}
```

- [ ] **Step 6: Run the test to verify it passes**

```bash
TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/nolan_dashboard pnpm test --run tests/import-rate-limit.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/db/schema.ts lib/import/rate-limit.ts tests/import-rate-limit.test.ts drizzle/migrations
git commit -m "feat: add import parse rate limiting"
```

---

## Task 2: Extraction schema and JSON extractor

**Files:**
- Create: `lib/import/schema.ts`
- Create: `lib/import/openrouter.ts` (partial — `extractJsonObject` only this task; `callOpenRouter` in Task 6)
- Test: `tests/import-schema.test.ts`
- Test: `tests/import-json.test.ts`

**Interfaces:**
- Produces: `ImportKind = 'screenshot' | 'markdown' | 'voice'`, `extractedJobSchema: ZodType`, `ExtractedJob = z.infer<typeof extractedJobSchema>`, `extractJsonObject(text: string): unknown`.

- [ ] **Step 1: Write the failing schema test**

Create `tests/import-schema.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extractedJobSchema } from '@/lib/import/schema';

describe('extractedJobSchema', () => {
  it('accepts a realistic full extraction', () => {
    const result = extractedJobSchema.safeParse({
      customerName: 'Sarah Doyle',
      customerPhone: '087 123 4567',
      vehicleRegistration: '251-WX-1001',
      vehicleMake: 'Toyota',
      vehicleModel: 'Corolla',
      dueDate: '2026-08-25',
      dueTime: '09:30',
      priority: 'medium',
      labourLines: [{ description: 'Front brake discs and pads', hours: '2.5' }],
      parts: [{ partName: 'Brake pads', partNumber: 'BP-100', qty: '1', unitPrice: '45.00' }],
    });

    expect(result.success).toBe(true);
  });

  it('accepts an almost-empty extraction — most fields genuinely absent', () => {
    const result = extractedJobSchema.safeParse({ customerName: 'Walk-in customer' });
    expect(result.success).toBe(true);
  });

  it('accepts a completely empty object', () => {
    expect(extractedJobSchema.safeParse({}).success).toBe(true);
  });

  it('tolerates hours/qty/price sent as numbers, not just strings', () => {
    const result = extractedJobSchema.safeParse({
      labourLines: [{ description: 'Oil change', hours: 1 }],
      parts: [{ partName: 'Oil filter', qty: 1, unitPrice: 12.5 }],
    });

    expect(result.success).toBe(true);
  });

  it('drops rather than throws on a malformed labour line', () => {
    // A non-object entry in the array is the kind of thing a model occasionally
    // produces — the array item schema should reject just that entry's shape,
    // not the whole array, when used with .safeParse at the call site.
    const result = extractedJobSchema.safeParse({
      labourLines: [{ description: 'Fine', hours: '1' }, 'not an object'],
    });

    expect(result.success).toBe(false);
  });

  it('never defines status, hourlyRate, or labourTotalOverride as recognised keys', () => {
    // These three must never be part of what the model is asked to produce —
    // even if present in the input, parsing must not surface them as valid
    // output fields a caller could accidentally forward to createJob.
    const shape = extractedJobSchema.shape as Record<string, unknown>;
    expect(shape.status).toBeUndefined();
    expect(shape.hourlyRate).toBeUndefined();
    expect(shape.labourTotalOverride).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test --run tests/import-schema.test.ts 2>&1 | tail -30
```

Expected: FAIL — `lib/import/schema.ts` does not exist.

- [ ] **Step 3: Implement `lib/import/schema.ts`**

```ts
import { z } from 'zod';

export type ImportKind = 'screenshot' | 'markdown' | 'voice';

const extractedLabourLineSchema = z.object({
  description: z.string().trim().max(300).optional(),
  hours: z.union([z.string(), z.number()]).optional(),
});

const extractedPartLineSchema = z.object({
  partName: z.string().trim().max(200).optional(),
  partNumber: z.string().trim().max(60).optional(),
  qty: z.union([z.string(), z.number()]).optional(),
  unitPrice: z.union([z.string(), z.number()]).optional(),
});

/**
 * What the model is asked to return, validated leniently — a photo or a
 * ten-second voice note routinely won't supply everything, so every field is
 * optional here. The form's own `jobInputSchema` still enforces what's
 * actually required (customerName, vehicleRegistration) at real submit time,
 * unchanged.
 *
 * Deliberately excludes `status`, `hourlyRate`, and `labourTotalOverride` —
 * see the Global Constraints note in the plan this schema was built from.
 * Do not add them here without also adding an explicit guard wherever the
 * resulting prefill could reach `createJob`.
 */
export const extractedJobSchema = z.object({
  customerName: z.string().trim().max(200).optional(),
  customerPhone: z.string().trim().max(50).optional(),
  customerEmail: z.string().trim().max(200).optional(),
  customerAddress: z.string().trim().max(500).optional(),

  vehicleRegistration: z.string().trim().max(32).optional(),
  vehicleMake: z.string().trim().max(100).optional(),
  vehicleModel: z.string().trim().max(100).optional(),
  vehicleVin: z.string().trim().max(50).optional(),
  vehicleColor: z.string().trim().max(50).optional(),
  vehicleYear: z.union([z.string(), z.number()]).optional(),
  vehicleMileage: z.union([z.string(), z.number()]).optional(),

  dueDate: z.string().trim().optional(),
  dueTime: z.string().trim().optional(),
  priority: z.string().trim().optional(),

  labourLines: z.array(extractedLabourLineSchema).max(50).optional().default([]),
  parts: z.array(extractedPartLineSchema).max(50).optional().default([]),

  otherComments: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type ExtractedJob = z.infer<typeof extractedJobSchema>;
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm test --run tests/import-schema.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Write the failing JSON-extractor test**

Create `tests/import-json.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { extractJsonObject } from '@/lib/import/openrouter';

describe('extractJsonObject', () => {
  it('parses clean JSON', () => {
    expect(extractJsonObject('{"customerName":"Sarah Doyle"}')).toEqual({
      customerName: 'Sarah Doyle',
    });
  });

  it('strips a ```json fenced block', () => {
    const text = '```json\n{"customerName":"Sarah Doyle"}\n```';
    expect(extractJsonObject(text)).toEqual({ customerName: 'Sarah Doyle' });
  });

  it('strips a plain ``` fenced block with no language tag', () => {
    const text = '```\n{"customerName":"Sarah Doyle"}\n```';
    expect(extractJsonObject(text)).toEqual({ customerName: 'Sarah Doyle' });
  });

  it('tolerates stray prose before and after the JSON object', () => {
    const text = 'Here is the extracted job:\n{"customerName":"Sarah Doyle"}\nLet me know if you need more.';
    expect(extractJsonObject(text)).toEqual({ customerName: 'Sarah Doyle' });
  });

  it('throws a clear error on genuinely unparseable text', () => {
    expect(() => extractJsonObject('I could not find any job details in that image.')).toThrow(
      /could not/i,
    );
  });

  it('throws rather than silently returning an empty object on empty input', () => {
    expect(() => extractJsonObject('')).toThrow();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

```bash
pnpm test --run tests/import-json.test.ts 2>&1 | tail -30
```

Expected: FAIL — `lib/import/openrouter.ts` does not exist.

- [ ] **Step 7: Implement `extractJsonObject`**

Create `lib/import/openrouter.ts` (this task only adds `extractJsonObject`; `callOpenRouter` and the model config are added in Task 6 — the file is `server-only` throughout):

```ts
import 'server-only';

/**
 * Tolerant JSON extraction from an LLM's raw text response.
 *
 * Models are instructed to return JSON only, but reliably ignore that
 * instruction often enough to need this: strips a ```json/``` fence if
 * present, then takes the substring from the first `{` to the last `}` (so
 * stray prose before/after the object is discarded), then parses it. Throws a
 * clear, user-facing-safe error if nothing parseable is found — never
 * silently returns `{}`, which would look identical to "the model found
 * nothing" and mask a real failure.
 */
export function extractJsonObject(text: string): unknown {
  const withoutFences = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  const start = withoutFences.indexOf('{');
  const end = withoutFences.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('Could not find a JSON object in the model response.');
  }

  const candidate = withoutFences.slice(start, end + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error('Could not parse the model response as JSON.');
  }
}
```

- [ ] **Step 8: Run it to verify it passes**

```bash
pnpm test --run tests/import-json.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 9: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/import/schema.ts lib/import/openrouter.ts tests/import-schema.test.ts tests/import-json.test.ts
git commit -m "feat: add import extraction schema and JSON extractor"
```

---

## Task 3: Vehicle make/model normalisation

**Files:**
- Modify: `lib/vehicles.ts`
- Test: `tests/vehicles.test.ts` (create if it doesn't exist, extend if it does)

**Interfaces:**
- Consumes: `MAKE_NAMES`, `modelsForMake`, `isKnownMake`, `OTHER_OPTION` — all already exported from `lib/vehicles.ts`.
- Produces: `normaliseMake(raw: string | undefined | null): string | undefined`, `normaliseModel(make: string | undefined, raw: string | undefined | null): string | undefined`.

- [ ] **Step 1: Confirm whether `tests/vehicles.test.ts` already exists**

```bash
ls tests/vehicles.test.ts 2>&1
```

If it exists, read it first and add the new `describe` block below to the end of the file rather than replacing anything. If it doesn't exist, create it fresh with just the block below (plus the standard `import { describe, expect, it } from 'vitest';` at the top).

- [ ] **Step 2: Write the failing test**

```ts
import { normaliseMake, normaliseModel } from '@/lib/vehicles';

describe('normaliseMake', () => {
  it('passes through an exact match unchanged', () => {
    expect(normaliseMake('Toyota')).toBe('Toyota');
  });

  it('matches case-insensitively', () => {
    expect(normaliseMake('toyota')).toBe('Toyota');
  });

  it('applies the alias table for common LLM-produced spellings', () => {
    expect(normaliseMake('VW')).toBe('Volkswagen');
    expect(normaliseMake('Volkswagon')).toBe('Volkswagen');
    expect(normaliseMake('Mercedes')).toBe('Mercedes-Benz');
    expect(normaliseMake('Landrover')).toBe('Land Rover');
  });

  it('matches accent/case variants against an accented make name', () => {
    expect(normaliseMake('citroen')).toBe('Citroën');
    expect(normaliseMake('CITROEN')).toBe('Citroën');
  });

  it('passes through an unknown make unchanged, trimmed', () => {
    expect(normaliseMake('  Griffon Motors  ')).toBe('Griffon Motors');
  });

  it('returns undefined for empty/missing input', () => {
    expect(normaliseMake(undefined)).toBeUndefined();
    expect(normaliseMake(null)).toBeUndefined();
    expect(normaliseMake('   ')).toBeUndefined();
  });
});

describe('normaliseModel', () => {
  it('passes through an exact match for the given make unchanged', () => {
    expect(normaliseModel('Toyota', 'Corolla')).toBe('Corolla');
  });

  it('matches case-insensitively within the given make', () => {
    expect(normaliseModel('Toyota', 'corolla')).toBe('Corolla');
  });

  it('passes through unchanged when the make is unknown', () => {
    expect(normaliseModel('Griffon Motors', 'Falcon')).toBe('Falcon');
  });

  it('passes through unchanged when the model is not in the known make\'s list', () => {
    expect(normaliseModel('Toyota', 'Model S')).toBe('Model S');
  });

  it('returns undefined for empty/missing input', () => {
    expect(normaliseModel('Toyota', undefined)).toBeUndefined();
    expect(normaliseModel(undefined, 'Corolla')).toBe('Corolla');
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
pnpm test --run tests/vehicles.test.ts 2>&1 | tail -30
```

Expected: FAIL — `normaliseMake`/`normaliseModel` don't exist.

- [ ] **Step 4: Implement the normalisers**

Add to the end of `lib/vehicles.ts` (after the existing `isKnownMake`/`modelsForMake`/etc. — read the file first to confirm those exact export names before wiring against them, since this task builds directly on top of them):

```ts
/** Common misspellings/abbreviations an LLM produces for a make it clearly means. */
const MAKE_ALIASES: Record<string, string> = {
  vw: 'Volkswagen',
  volkswagon: 'Volkswagen',
  mercedes: 'Mercedes-Benz',
  landrover: 'Land Rover',
  citroen: 'Citroën',
};

/** Case/accent-insensitive key for matching against the alias table and MAKE_NAMES. */
function foldKey(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Best-effort match against the known-makes list, for a value an LLM
 * extracted rather than one the owner picked from the dropdown. Unmatched
 * values pass through unchanged (trimmed) rather than being dropped — that's
 * exactly what routes them into `VehicleFields`' existing free-text "Other…"
 * fallback instead of silently discarding real data the owner can still see
 * and correct.
 */
export function normaliseMake(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;

  const key = foldKey(trimmed);
  if (MAKE_ALIASES[key]) return MAKE_ALIASES[key];

  const known = MAKE_NAMES.find((name) => foldKey(name) === key);
  return known ?? trimmed;
}

export function normaliseModel(
  make: string | undefined,
  raw: string | undefined | null,
): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === '') return undefined;
  if (!make) return trimmed;

  const key = foldKey(trimmed);
  const known = modelsForMake(make).find((name) => foldKey(name) === key);
  return known ?? trimmed;
}
```

- [ ] **Step 5: Run it to verify it passes**

```bash
pnpm test --run tests/vehicles.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/vehicles.ts tests/vehicles.test.ts
git commit -m "feat: add vehicle make/model normalisation for imported data"
```

---

## Task 4: Extraction prompt and OpenRouter message builder

**Files:**
- Create: `lib/import/prompt.ts`
- Test: `tests/import-prompt.test.ts`

**Interfaces:**
- Consumes: `ImportKind` from `lib/import/schema.ts`.
- Produces: `buildExtractionPrompt(kind: ImportKind): string`, `buildMessages(kind: ImportKind, payload: { text: string } | { base64: string; mimeType: string }): unknown[]`, `mapMimeToOpenRouterFormat(mimeType: string): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/import-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildExtractionPrompt, buildMessages, mapMimeToOpenRouterFormat } from '@/lib/import/prompt';

describe('buildExtractionPrompt', () => {
  it('never mentions status, hourlyRate, or labourTotalOverride', () => {
    // Regression guard for the exact safety issue this whole schema design
    // exists to avoid — the model must never be told these fields exist.
    for (const kind of ['screenshot', 'markdown', 'voice'] as const) {
      const prompt = buildExtractionPrompt(kind).toLowerCase();
      expect(prompt).not.toContain('hourlyrate');
      expect(prompt).not.toContain('labourtotaloverride');
      expect(prompt).not.toMatch(/\bstatus\b/);
    }
  });

  it('mentions JSON-only output for every kind', () => {
    for (const kind of ['screenshot', 'markdown', 'voice'] as const) {
      expect(buildExtractionPrompt(kind).toLowerCase()).toContain('json');
    }
  });
});

describe('buildMessages', () => {
  it('builds a plain string message for markdown', () => {
    const messages = buildMessages('markdown', { text: 'Oil change for Sarah Doyle' }) as Array<{
      role: string;
      content: unknown;
    }>;

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(typeof messages[0]!.content).toBe('string');
    expect(messages[0]!.content as string).toContain('Oil change for Sarah Doyle');
  });

  it('builds an image_url content block for a screenshot', () => {
    const messages = buildMessages('screenshot', { base64: 'AAAA', mimeType: 'image/png' }) as Array<{
      content: Array<{ type: string; image_url?: { url: string } }>;
    }>;

    const content = messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const imageBlock = content.find((block) => block.type === 'image_url');
    expect(imageBlock).toBeDefined();
    expect(imageBlock!.image_url!.url).toBe('data:image/png;base64,AAAA');
  });

  it('builds an input_audio content block for voice, with the mapped format', () => {
    const messages = buildMessages('voice', { base64: 'BBBB', mimeType: 'audio/mp4' }) as Array<{
      content: Array<{ type: string; input_audio?: { data: string; format: string } }>;
    }>;

    const content = messages[0]!.content;
    const audioBlock = content.find((block) => block.type === 'input_audio');
    expect(audioBlock).toBeDefined();
    expect(audioBlock!.input_audio).toEqual({ data: 'BBBB', format: 'm4a' });
  });
});

describe('mapMimeToOpenRouterFormat', () => {
  it('maps common audio mime types to OpenRouter-accepted formats', () => {
    expect(mapMimeToOpenRouterFormat('audio/mp4')).toBe('m4a');
    expect(mapMimeToOpenRouterFormat('audio/aac')).toBe('aac');
    expect(mapMimeToOpenRouterFormat('audio/mpeg')).toBe('mp3');
    expect(mapMimeToOpenRouterFormat('audio/wav')).toBe('wav');
    expect(mapMimeToOpenRouterFormat('audio/ogg')).toBe('ogg');
  });

  it('throws on an unsupported mime type rather than silently guessing', () => {
    expect(() => mapMimeToOpenRouterFormat('audio/webm')).toThrow();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test --run tests/import-prompt.test.ts 2>&1 | tail -30
```

Expected: FAIL — `lib/import/prompt.ts` does not exist.

- [ ] **Step 3: Implement `lib/import/prompt.ts`**

```ts
import 'server-only';

import type { ImportKind } from './schema';

const KIND_INTRO: Record<ImportKind, string> = {
  screenshot: 'You are looking at a screenshot of a message or note describing a car repair job.',
  markdown: 'You are reading a block of freeform notes describing a car repair job.',
  voice: "You are listening to a voice recording of a garage owner describing a car repair job.",
};

/**
 * One shared instruction block per kind, varying only the opening sentence.
 * Deliberately never mentions `status`, `hourlyRate`, or `labourTotalOverride`
 * — see the Global Constraints note in the plan this was built from. If you
 * are adding a field to the prompt, check `extractedJobSchema` first: if it
 * is not in that schema, it must not be in this prompt either.
 */
export function buildExtractionPrompt(kind: ImportKind): string {
  const audioNote =
    kind === 'voice'
      ? ' Listen to the whole recording before answering — the transcription is an internal step, not part of your output.'
      : '';

  return `${KIND_INTRO[kind]}${audioNote}

Extract only what is explicitly stated. Do not invent or guess a value that
is not present — omit a field entirely rather than filling it with a
plausible-looking guess.

Return a single JSON object with any of these fields you can find, and
nothing else:

{
  "customerName": string,
  "customerPhone": string,
  "customerEmail": string,
  "customerAddress": string,
  "vehicleRegistration": string,
  "vehicleMake": string,
  "vehicleModel": string,
  "vehicleVin": string,
  "vehicleColor": string,
  "vehicleYear": string,
  "vehicleMileage": string,
  "dueDate": string (YYYY-MM-DD, only if an actual date is stated),
  "dueTime": string (24-hour HH:MM, only if an actual time is stated),
  "priority": string (one of: low, medium, high — only if actually implied),
  "labourLines": [{ "description": string, "hours": string }],
  "parts": [{ "partName": string, "partNumber": string, "qty": string, "unitPrice": string }],
  "otherComments": string,
  "notes": string
}

Return ONLY the JSON object. No markdown fences, no commentary, no explanation.`;
}

type MessagePayload = { text: string } | { base64: string; mimeType: string };

function isTextPayload(payload: MessagePayload): payload is { text: string } {
  return 'text' in payload;
}

/**
 * Assembles the OpenRouter `messages` array for one import kind. Markdown is
 * a plain string; screenshot/voice attach a content block alongside the same
 * prompt text — the only thing that differs between the three kinds.
 */
export function buildMessages(kind: ImportKind, payload: MessagePayload): unknown[] {
  const prompt = buildExtractionPrompt(kind);

  if (kind === 'markdown') {
    if (!isTextPayload(payload)) {
      throw new Error('buildMessages: markdown import requires a text payload.');
    }
    return [{ role: 'user', content: `${prompt}\n\n---\n${payload.text}` }];
  }

  if (isTextPayload(payload)) {
    throw new Error(`buildMessages: ${kind} import requires a base64/mimeType payload.`);
  }

  if (kind === 'screenshot') {
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${payload.mimeType};base64,${payload.base64}` } },
        ],
      },
    ];
  }

  // kind === 'voice'
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'input_audio',
          input_audio: { data: payload.base64, format: mapMimeToOpenRouterFormat(payload.mimeType) },
        },
      ],
    },
  ];
}

const AUDIO_FORMAT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aiff': 'aiff',
};

/**
 * OpenRouter's audio input accepts a fixed set of formats
 * (wav/mp3/aiff/aac/ogg/flac/m4a/pcm16/pcm24) — notably NOT `webm`, which is
 * Chrome's `MediaRecorder` default. Throws on anything unmapped rather than
 * guessing, since sending the wrong format silently fails the OpenRouter call.
 */
export function mapMimeToOpenRouterFormat(mimeType: string): string {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  const format = AUDIO_FORMAT_BY_MIME[base];
  if (!format) {
    throw new Error(`Unsupported audio format "${mimeType}" — no OpenRouter-accepted mapping.`);
  }
  return format;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm test --run tests/import-prompt.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/import/prompt.ts tests/import-prompt.test.ts
git commit -m "feat: add the shared extraction prompt and OpenRouter message builder"
```

---

## Task 5: Prefill mapper

**Files:**
- Create: `lib/import/map.ts`
- Test: `tests/import-map.test.ts`

**Interfaces:**
- Consumes: `ExtractedJob` from `lib/import/schema.ts`, `normaliseMake`/`normaliseModel` from `lib/vehicles.ts`, `JOB_PRIORITIES` from `lib/validation/job.ts`.
- Produces: `ImportPrefill` interface, `mapExtractedToPrefill(extracted: ExtractedJob): ImportPrefill`, `isPrefillEmpty(prefill: ImportPrefill): boolean`.

- [ ] **Step 1: Write the failing test**

Create `tests/import-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { isPrefillEmpty, mapExtractedToPrefill } from '@/lib/import/map';

describe('mapExtractedToPrefill', () => {
  it('carries through simple string fields unchanged', () => {
    const prefill = mapExtractedToPrefill({
      customerName: 'Sarah Doyle',
      customerPhone: '087 123 4567',
      labourLines: [],
      parts: [],
    });

    expect(prefill.customerName).toBe('Sarah Doyle');
    expect(prefill.customerPhone).toBe('087 123 4567');
  });

  it('normalises vehicle make/model via lib/vehicles', () => {
    const prefill = mapExtractedToPrefill({
      vehicleMake: 'toyota',
      vehicleModel: 'corolla',
      labourLines: [],
      parts: [],
    });

    expect(prefill.vehicleMake).toBe('Toyota');
    expect(prefill.vehicleModel).toBe('Corolla');
  });

  it('drops a labour line with no description', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [{ description: '', hours: '2' }, { description: 'Oil change', hours: '1' }],
      parts: [],
    });

    expect(prefill.labourLines).toHaveLength(1);
    expect(prefill.labourLines[0]!.description).toBe('Oil change');
  });

  it('drops a part with no name', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [],
      parts: [
        { partName: '', qty: '1', unitPrice: '10' },
        { partName: 'Oil filter', qty: '1', unitPrice: '12.50' },
      ],
    });

    expect(prefill.parts).toHaveLength(1);
    expect(prefill.parts[0]!.partName).toBe('Oil filter');
  });

  it('normalises hours/qty/unitPrice text into plain decimal strings', () => {
    const prefill = mapExtractedToPrefill({
      labourLines: [{ description: 'Oil change', hours: '2.5 hours' }],
      parts: [{ partName: 'Filter', qty: '1x', unitPrice: '€45.00' }],
    });

    expect(prefill.labourLines[0]!.hours).toBe('2.5');
    expect(prefill.parts[0]!.qty).toBe('1');
    expect(prefill.parts[0]!.unitPrice).toBe('45.00');
  });

  it('drops an out-of-range or non-numeric year rather than passing it through', () => {
    expect(mapExtractedToPrefill({ vehicleYear: '1850', labourLines: [], parts: [] }).vehicleYear).toBeUndefined();
    expect(mapExtractedToPrefill({ vehicleYear: 'not a year', labourLines: [], parts: [] }).vehicleYear).toBeUndefined();
    expect(mapExtractedToPrefill({ vehicleYear: '2024', labourLines: [], parts: [] }).vehicleYear).toBe(2024);
  });

  it('drops an invalid priority rather than passing it through', () => {
    expect(mapExtractedToPrefill({ priority: 'urgent', labourLines: [], parts: [] }).priority).toBeUndefined();
    expect(mapExtractedToPrefill({ priority: 'high', labourLines: [], parts: [] }).priority).toBe('high');
  });

  it('drops an invalid date/time rather than passing it through', () => {
    expect(mapExtractedToPrefill({ dueDate: 'next tuesday', labourLines: [], parts: [] }).dueDate).toBeUndefined();
    expect(mapExtractedToPrefill({ dueDate: '2026-08-25', labourLines: [], parts: [] }).dueDate).toBe('2026-08-25');
    expect(mapExtractedToPrefill({ dueTime: '9:30am', labourLines: [], parts: [] }).dueTime).toBeUndefined();
    expect(mapExtractedToPrefill({ dueTime: '09:30', labourLines: [], parts: [] }).dueTime).toBe('09:30');
  });

  it('caps labourLines and parts at 50 entries', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ description: `Line ${i}`, hours: '1' }));
    const prefill = mapExtractedToPrefill({ labourLines: many, parts: [] });
    expect(prefill.labourLines).toHaveLength(50);
  });
});

describe('isPrefillEmpty', () => {
  it('is true for a genuinely empty extraction', () => {
    expect(isPrefillEmpty(mapExtractedToPrefill({ labourLines: [], parts: [] }))).toBe(true);
  });

  it('is false when even one field is populated', () => {
    expect(
      isPrefillEmpty(mapExtractedToPrefill({ customerName: 'Sarah Doyle', labourLines: [], parts: [] })),
    ).toBe(false);
  });

  it('is false when only a labour line is populated', () => {
    expect(
      isPrefillEmpty(
        mapExtractedToPrefill({ labourLines: [{ description: 'Oil change', hours: '1' }], parts: [] }),
      ),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test --run tests/import-map.test.ts 2>&1 | tail -30
```

Expected: FAIL — `lib/import/map.ts` does not exist.

- [ ] **Step 3: Implement `lib/import/map.ts`**

```ts
import 'server-only';

import { normaliseMake, normaliseModel } from '@/lib/vehicles';
import { JOB_PRIORITIES } from '@/lib/validation/job';
import type { ExtractedJob } from './schema';

export interface ImportLabourLine {
  description: string;
  hours: string;
}

export interface ImportPartLine {
  partName: string;
  partNumber: string;
  qty: string;
  unitPrice: string;
}

/** Form-ready prefill data — every field optional/absent rather than null, matching `JobForm`'s existing `Prefill` shape. */
export interface ImportPrefill {
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  customerAddress?: string;
  vehicleRegistration?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  vehicleVin?: string;
  vehicleColor?: string;
  vehicleYear?: number;
  vehicleMileage?: number;
  dueDate?: string;
  dueTime?: string;
  priority?: string;
  labourLines: ImportLabourLine[];
  parts: ImportPartLine[];
  otherComments?: string;
  notes?: string;
}

const CURRENT_YEAR = new Date().getFullYear();

/** "2.5 hours" / 2.5 / "€45.00" / "1x" -> a plain decimal string, or undefined if nothing numeric is present. */
function toDecimalString(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const raw = String(value);
  const match = raw.match(/\d+(\.\d+)?/);
  if (!match) return undefined;
  return match[0];
}

function toOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed && trimmed !== '' ? trimmed : undefined;
}

function toValidYear(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return undefined;
  if (n < 1900 || n > CURRENT_YEAR + 2) return undefined;
  return n;
}

function toValidMileage(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return undefined;
  if (n < 0 || n > 5_000_000) return undefined;
  return n;
}

function toValidDate(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return undefined;
  return trimmed;
}

function toValidTime(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trimmed)) return undefined;
  return trimmed;
}

function toValidPriority(value: string | undefined): string | undefined {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && (JOB_PRIORITIES as readonly string[]).includes(trimmed) ? trimmed : undefined;
}

/**
 * Normalizes a raw LLM extraction into what `JobForm` actually consumes.
 * Rows with no meaningful content are dropped rather than kept as blank
 * lines the owner would have to notice and remove by hand. Anything that
 * doesn't validate (a bad date, an out-of-range year, an unknown priority)
 * is dropped, not passed through wrong — silence is safer than a confidently
 * wrong value on a real customer's job.
 */
export function mapExtractedToPrefill(extracted: ExtractedJob): ImportPrefill {
  const labourLines: ImportLabourLine[] = (extracted.labourLines ?? [])
    .map((line) => ({
      description: toOptionalString(line.description) ?? '',
      hours: toDecimalString(line.hours) ?? '',
    }))
    .filter((line) => line.description !== '')
    .slice(0, 50);

  const parts: ImportPartLine[] = (extracted.parts ?? [])
    .map((part) => ({
      partName: toOptionalString(part.partName) ?? '',
      partNumber: toOptionalString(part.partNumber) ?? '',
      qty: toDecimalString(part.qty) ?? '',
      unitPrice: toDecimalString(part.unitPrice) ?? '',
    }))
    .filter((part) => part.partName !== '')
    .slice(0, 50);

  const make = normaliseMake(extracted.vehicleMake);

  return {
    customerName: toOptionalString(extracted.customerName),
    customerPhone: toOptionalString(extracted.customerPhone),
    customerEmail: toOptionalString(extracted.customerEmail),
    customerAddress: toOptionalString(extracted.customerAddress),
    vehicleRegistration: toOptionalString(extracted.vehicleRegistration)?.toUpperCase(),
    vehicleMake: make,
    vehicleModel: normaliseModel(make, extracted.vehicleModel),
    vehicleVin: toOptionalString(extracted.vehicleVin),
    vehicleColor: toOptionalString(extracted.vehicleColor),
    vehicleYear: toValidYear(extracted.vehicleYear),
    vehicleMileage: toValidMileage(extracted.vehicleMileage),
    dueDate: toValidDate(extracted.dueDate),
    dueTime: toValidTime(extracted.dueTime),
    priority: toValidPriority(extracted.priority),
    labourLines,
    parts,
    otherComments: toOptionalString(extracted.otherComments),
    notes: toOptionalString(extracted.notes),
  };
}

/** True only when every field and both arrays are empty — the "found nothing usable" case. */
export function isPrefillEmpty(prefill: ImportPrefill): boolean {
  const { labourLines, parts, ...scalars } = prefill;
  const hasScalar = Object.values(scalars).some((value) => value !== undefined);
  return !hasScalar && labourLines.length === 0 && parts.length === 0;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm test --run tests/import-map.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/import/map.ts tests/import-map.test.ts
git commit -m "feat: add the extraction-to-prefill mapper"
```

---

## Task 6: OpenRouter client

**Files:**
- Modify: `lib/import/openrouter.ts` (add `callOpenRouter` and model config alongside the existing `extractJsonObject`)
- Test: `tests/import-openrouter.test.ts`

**Interfaces:**
- Consumes: `ImportKind` from `lib/import/schema.ts`.
- Produces: `callOpenRouter(kind: ImportKind, messages: unknown[]): Promise<string>`.

- [ ] **Step 1: Write the failing test**

Create `tests/import-openrouter.test.ts`. This mocks `global.fetch` — no real network call, deterministic:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import { callOpenRouter } from '@/lib/import/openrouter';

function mockFetchOnce(response: { ok: boolean; status?: number; body: unknown }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: async () => response.body,
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('callOpenRouter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('posts to the OpenRouter chat completions endpoint with the given messages', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    const fetchMock = mockFetchOnce({
      ok: true,
      body: { choices: [{ message: { content: '{"customerName":"Sarah Doyle"}' } }] },
    });

    const result = await callOpenRouter('markdown', [{ role: 'user', content: 'hello' }]);

    expect(result).toBe('{"customerName":"Sarah Doyle"}');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer test-key');
    const body = JSON.parse(init.body);
    expect(body.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('throws a clear error on a non-2xx response', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    mockFetchOnce({ ok: false, status: 429, body: { error: { message: 'rate limited upstream' } } });

    await expect(callOpenRouter('markdown', [])).rejects.toThrow(/rate limited upstream|OpenRouter/);
  });

  it('throws a clear error when the response has no message content', async () => {
    vi.stubEnv('OPENROUTER_API_KEY', 'test-key');
    mockFetchOnce({ ok: true, body: { choices: [] } });

    await expect(callOpenRouter('markdown', [])).rejects.toThrow();
  });

  it('throws immediately, without calling fetch, if OPENROUTER_API_KEY is not set', async () => {
    const fetchMock = mockFetchOnce({ ok: true, body: {} });

    await expect(callOpenRouter('markdown', [])).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test --run tests/import-openrouter.test.ts 2>&1 | tail -30
```

Expected: FAIL — `callOpenRouter` does not exist.

- [ ] **Step 3: Implement `callOpenRouter`**

Add to `lib/import/openrouter.ts` (below the existing `extractJsonObject`):

```ts
import type { ImportKind } from './schema';

/**
 * Model choice per kind. Voice needs an audio-input-capable model — a
 * materially smaller set than the vision-capable set, so screenshot and
 * voice are not assumed to share a model. **Verify these IDs against
 * OpenRouter's live model list before shipping** — this is a config value
 * subject to that catalog changing, not a fact fixed by research done at
 * plan-writing time. `google/gemini-2.5-flash` is used as a starting default
 * for all three because OpenRouter's own audio-input documentation uses it
 * as the worked example for `input_audio`, so it is confirmed to support
 * that content type; confirm it (or replace it) for vision/text quality too.
 */
export const OPENROUTER_MODELS: Record<ImportKind, string> = {
  screenshot: 'google/gemini-2.5-flash',
  markdown: 'google/gemini-2.5-flash',
  voice: 'google/gemini-2.5-flash',
};

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Plain `fetch` to OpenRouter's OpenAI-compatible chat-completions endpoint —
 * no SDK, matching this codebase's existing lean-dependency style (no `ai`,
 * `openai`, or `@anthropic-ai/sdk` package installed anywhere else). Low
 * temperature since this is extraction, not creative generation.
 */
export async function callOpenRouter(kind: ImportKind, messages: unknown[]): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY is not set. Copy .env.example and fill it in.');
  }

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: OPENROUTER_MODELS[kind],
      temperature: 0.1,
      messages,
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    | null;

  if (!response.ok) {
    throw new Error(body?.error?.message ?? `OpenRouter request failed with status ${response.status}.`);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter returned no content.');
  }

  return content;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm test --run tests/import-openrouter.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/import/openrouter.ts tests/import-openrouter.test.ts
git commit -m "feat: add the OpenRouter chat-completions client"
```

---

## Task 7: R2 helpers and the import upload-url route

**Files:**
- Modify: `lib/storage/signedUrl.ts`
- Create: `app/api/import/upload-url/route.ts`
- Test: none automated for the route itself (network/R2-dependent, matches how the existing attachments upload-url route has no test) — `buildImportPath` gets a unit test since it's pure.

**Interfaces:**
- Produces: `buildImportPath(fileName: string): string`, `fetchObjectBytes(bucket: string, storagePath: string): Promise<Uint8Array>`.

- [ ] **Step 1: Write the failing test for `buildImportPath`**

Create `tests/import-storage.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import { buildImportPath } from '@/lib/storage/signedUrl';

describe('buildImportPath', () => {
  it('prefixes with imports/ and a uuid, sanitising the filename', () => {
    const path = buildImportPath('My Photo (1).jpeg');
    expect(path).toMatch(/^imports\/[0-9a-f-]{36}-My_Photo__1_\.jpeg$/);
  });

  it('produces a different path on each call', () => {
    const a = buildImportPath('note.md');
    const b = buildImportPath('note.md');
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm test --run tests/import-storage.test.ts 2>&1 | tail -30
```

Expected: FAIL — `buildImportPath` does not exist.

- [ ] **Step 3: Add `buildImportPath` and `fetchObjectBytes` to `lib/storage/signedUrl.ts`**

Add near the other path-builders (after `buildInvoicePath`):

```ts
/**
 * Import uploads (a screenshot or voice recording, parsed once and
 * discarded) have no `jobId` yet — the job doesn't exist until after import
 * succeeds — so they can't use `buildJobAttachmentPath`, which requires one.
 */
export function buildImportPath(fileName: string): string {
  return `imports/${randomUUID()}-${sanitiseFileName(fileName)}`;
}
```

Add near `removeObject`/`removeObjects` (needs a new import — add `GetObjectCommand` to the existing `@aws-sdk/client-s3` import at the top of the file):

```ts
/**
 * Read an object's bytes directly, server-side — used to base64-encode an
 * imported screenshot/recording into an OpenRouter request. Mirrors the
 * private `fetchObject` helper in `lib/pdf/assets.ts` (which is hardcoded to
 * `INVOICES_BUCKET`), generalized here by bucket so both call sites could
 * eventually share one implementation.
 */
export async function fetchObjectBytes(bucket: string, storagePath: string): Promise<Uint8Array> {
  const result = await getR2().send(new GetObjectCommand({ Bucket: bucket, Key: storagePath }));

  if (!result.Body) {
    throw new Error(`Object "${storagePath}" is empty in R2.`);
  }

  const bytes = await result.Body.transformToByteArray();

  if (bytes.byteLength === 0) {
    throw new Error(`Object "${storagePath}" downloaded as zero bytes.`);
  }

  return bytes;
}
```

Update the top-of-file import to include `GetObjectCommand`:

```ts
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
```

(It's likely already imported for `createSignedDownloadUrl`'s `GetObjectCommand` usage — check before duplicating the import.)

- [ ] **Step 4: Run it to verify it passes**

```bash
pnpm test --run tests/import-storage.test.ts 2>&1 | tail -30
```

Expected: PASS.

- [ ] **Step 5: Create the upload-url route**

Create `app/api/import/upload-url/route.ts`, mirroring `app/api/attachments/upload-url/route.ts` exactly in shape but scoped to imports (no `jobId`/`supplierId`, no discriminated union needed since there's only one kind of target):

```ts
import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { buildImportPath, createSignedUploadUrl } from '@/lib/storage/signedUrl';

export const runtime = 'nodejs';

const requestSchema = z.object({
  fileName: z.string().min(1),
  mimeType: z.string().min(1),
});

/**
 * Mint a presigned upload URL for a screenshot or voice recording being
 * imported into a new job. Deliberately separate from
 * `/api/attachments/upload-url`: that route's path builder requires a
 * `jobId`, which doesn't exist yet at import time, and these objects are
 * never turned into a `job_attachments` row — they're parsed once by
 * `/api/import/parse` and then best-effort deleted.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid upload request' }, { status: 400 });
  }

  const storagePath = buildImportPath(parsed.data.fileName);

  try {
    const signed = await createSignedUploadUrl(ATTACHMENTS_BUCKET, storagePath, parsed.data.mimeType);
    return Response.json({ uploadUrl: signed.signedUrl, storagePath: signed.path });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not create upload URL' },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 6: Typecheck and commit**

```bash
pnpm typecheck 2>&1 | tail -20
git add lib/storage/signedUrl.ts app/api/import/upload-url/route.ts tests/import-storage.test.ts
git commit -m "feat: add import upload URL route and R2 byte-fetch helper"
```

---

## Task 8: The parse route

**Files:**
- Create: `app/api/import/parse/route.ts`
- Test: none automated (ties together rate-limit + R2 + a real OpenRouter call — covered by the unit tests on each piece in Tasks 1–6; this route itself is manual-verification-only, called out in Task 10's checklist)

**Interfaces:**
- Consumes: `admitParseAttempt` (Task 1), `buildMessages`/`mapMimeToOpenRouterFormat` (Task 4), `callOpenRouter`/`extractJsonObject` (Tasks 2, 6), `extractedJobSchema` (Task 2), `mapExtractedToPrefill`/`isPrefillEmpty` (Task 5), `fetchObjectBytes`/`removeObject` (Task 7, existing).

- [ ] **Step 1: Implement the route**

Create `app/api/import/parse/route.ts`:

```ts
import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import { db } from '@/lib/db';
import { extractedJobSchema } from '@/lib/import/schema';
import { isPrefillEmpty, mapExtractedToPrefill } from '@/lib/import/map';
import { callOpenRouter, extractJsonObject } from '@/lib/import/openrouter';
import { buildMessages } from '@/lib/import/prompt';
import { admitParseAttempt } from '@/lib/import/rate-limit';
import { ATTACHMENTS_BUCKET } from '@/lib/storage/r2';
import { fetchObjectBytes, removeObject } from '@/lib/storage/signedUrl';

export const runtime = 'nodejs';
// Vercel Hobby caps at 60s regardless of what's requested here — confirm
// against the actual plan this app runs on before relying on a higher value.
export const maxDuration = 60;

const bodySchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('markdown'), text: z.string().min(1).max(20_000) }),
  z.object({ kind: z.literal('screenshot'), storagePath: z.string().min(1), mimeType: z.string().min(1) }),
  z.object({ kind: z.literal('voice'), storagePath: z.string().min(1), mimeType: z.string().min(1) }),
]);

/**
 * The endpoint that costs money — every request here is one OpenRouter call.
 * Rate-limited via `admitParseAttempt` BEFORE any OpenRouter call, so a
 * rejected request never reaches the paid API at all.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid import request' }, { status: 400 });
  }

  const input = parsed.data;

  const admitted = await admitParseAttempt(db, input.kind);
  if (!admitted) {
    return Response.json(
      { error: 'Too many imports in a short time — wait a few minutes and try again.' },
      { status: 429 },
    );
  }

  try {
    const messages =
      input.kind === 'markdown'
        ? buildMessages('markdown', { text: input.text })
        : buildMessages(input.kind, {
            base64: Buffer.from(await fetchObjectBytes(ATTACHMENTS_BUCKET, input.storagePath)).toString(
              'base64',
            ),
            mimeType: input.mimeType,
          });

    const raw = await callOpenRouter(input.kind, messages);
    const json = extractJsonObject(raw);
    const extracted = extractedJobSchema.parse(json);
    const prefill = mapExtractedToPrefill(extracted);

    if (input.kind !== 'markdown') {
      // Best-effort — a failed delete must never fail the response; the
      // owner already has their prefill, and an orphaned R2 object is
      // harmless (never turned into a job_attachments row, never billed
      // meaningfully at this volume).
      removeObject(ATTACHMENTS_BUCKET, input.storagePath).catch(() => {});
    }

    return Response.json({ ok: true, prefill, empty: isPrefillEmpty(prefill) });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not read that import.' },
      { status: 502 },
    );
  }
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: zero errors. If `db` from `@/lib/db` doesn't satisfy `admitParseAttempt`'s `DbOrTx` parameter type, check `lib/counters.ts`'s exact `DbOrTx` definition — it should accept the proxy-wrapped `db` directly, since `allocateNumber` elsewhere is called the same way via `db.transaction(...)`.

- [ ] **Step 3: Manual verification (no automated test for this route — network + paid API + R2)**

With `OPENROUTER_API_KEY` set in `.env.local` and the dev server running:

```bash
curl -s -X POST http://localhost:3210/api/import/parse \
  -H "Content-Type: application/json" \
  -H "Cookie: <your session cookie from a logged-in browser>" \
  -d '{"kind":"markdown","text":"Sarah Doyle, 251-WX-1001, Toyota Corolla. Front brake discs and pads, about 2.5 hours."}' \
  | python3 -m json.tool
```

Expected: `{"ok": true, "prefill": {...}, "empty": false}` with `customerName`, `vehicleRegistration`, `vehicleMake`, `vehicleModel`, and a `labourLines` entry populated. Also try a deliberately empty/off-topic text to confirm `empty: true` triggers rather than the model inventing values, and send 11 requests in under 10 minutes to confirm the 11th returns 429.

- [ ] **Step 4: Commit**

```bash
git add app/api/import/parse/route.ts
git commit -m "feat: add the import parse route"
```

---

## Task 9: Thread prefill into `JobForm`

**Files:**
- Modify: `components/jobs/job-form.tsx`
- Test: none automated (no RTL installed in this repo) — manual verification checklist in Task 10.

**Interfaces:**
- Consumes: `ImportPrefill` from `lib/import/map.ts`.
- Produces: `JobForm` reads `sessionStorage.getItem('nolan:job-import-prefill')` on mount.

- [ ] **Step 1: Add the sessionStorage constant and read effect**

In `components/jobs/job-form.tsx`, add near the top (after the existing imports, before the `Section` component):

```ts
export const IMPORT_PREFILL_KEY = 'nolan:job-import-prefill';
```

(Exported so `components/jobs/new-job-modal.tsx`, built in Task 10, writes to the exact same key rather than a hand-typed duplicate string.)

Add `useEffect` to the existing `import { useState, useTransition, ... } from 'react';` line, and import `ImportPrefill`:

```ts
import { useEffect, useState, useTransition, type FormEvent, type ReactNode } from 'react';
import type { ImportPrefill } from '@/lib/import/map';
```

Inside `JobForm`, alongside the existing `prefill`/`prefillApplied` state (after the `const [lookingUp, setLookingUp] = useState(false);` line), add:

```ts
const [imported, setImported] = useState<ImportPrefill | null>(null);

/**
 * Must be a `useEffect`, not a lazy `useState` initializer. This component is
 * rendered from a Server Component and hydrated — a lazy initializer runs
 * during SSR too, where `sessionStorage` doesn't exist, so the server would
 * render "nothing imported" while the client's first hydration pass rendered
 * the real payload: a hydration mismatch on every prefilled `defaultValue`.
 * An effect runs strictly after hydration, so SSR and the first client
 * render agree, and the remount below (which reads `imported`) happens
 * cleanly afterward with no mismatch.
 *
 * Consumes and clears immediately — a stale entry from an earlier abandoned
 * import must never leak into a later, unrelated blank-form visit.
 */
useEffect(() => {
  const raw = sessionStorage.getItem(IMPORT_PREFILL_KEY);
  if (!raw) return;
  sessionStorage.removeItem(IMPORT_PREFILL_KEY);
  try {
    setImported(JSON.parse(raw) as ImportPrefill);
  } catch {
    // A corrupted entry is a missing convenience, not an error worth showing.
  }
}, []);
```

- [ ] **Step 2: Recompute labour/parts summaries when an import lands**

Immediately after the `imported` effect above, add a second effect — this is the fix for the gap where `labourSummary`/`partsSummary` are otherwise only ever set once at mount from `job` and never automatically refreshed by a `LineEditor` remount:

```ts
useEffect(() => {
  if (!imported) return;
  setLabourSummary({
    count: imported.labourLines.length,
    total: sumLabourHours(imported.labourLines.map((l) => ({ description: '', hours: l.hours ?? '' }))),
  });
  setPartsSummary({
    count: imported.parts.length,
    total: imported.parts.reduce((sum, p) => sum + applyQuantity(p.qty, p.unitPrice), 0),
  });
}, [imported]);
```

- [ ] **Step 3: Set the registration field directly for genuinely fresh pages**

`vehicleRegistration` is real controlled state, not `defaultValue` — add to the same first effect from Step 1 (inside the `try` block, after `setImported(...)`), or as its own small effect keyed on `imported`. Simplest: extend the Step 1 effect's `try` block:

```ts
useEffect(() => {
  const raw = sessionStorage.getItem(IMPORT_PREFILL_KEY);
  if (!raw) return;
  sessionStorage.removeItem(IMPORT_PREFILL_KEY);
  try {
    const parsedImport = JSON.parse(raw) as ImportPrefill;
    setImported(parsedImport);
    if (registration.trim() === '' && parsedImport.vehicleRegistration) {
      setRegistration(parsedImport.vehicleRegistration);
    }
  } catch {
    // A corrupted entry is a missing convenience, not an error worth showing.
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once on mount, deliberately not re-running on `registration` changes
}, []);
```

- [ ] **Step 4: Extend the remount key to cover Work/labour and Parts, and fix the three-way `??` chains**

Locate the existing `applyPrefill`/`applied` block:

```ts
function applyPrefill() {
  setPrefillApplied((n) => n + 1);
}

const applied = prefillApplied > 0 ? prefill : null;
```

Add directly below it:

```ts
/**
 * One composite version drives every remount this form does. `imported`
 * flips exactly once (null -> object, on mount) and then stays stable, so
 * this only changes twice in a session at most: once if/when an import
 * lands, and again each time the registration-lookup button is tapped.
 */
const formVersion = `${prefillApplied}:${imported ? 1 : 0}`;
```

Change the Customer+Vehicle wrapper's key:

```tsx
<div key={prefillApplied} className="flex flex-col gap-3">
```
becomes
```tsx
<div key={formVersion} className="flex flex-col gap-3">
```

Change every `defaultValue={applied?.X ?? job?.X ?? ''}` in that wrapper (Customer and Vehicle sections — `customerName`, `customerPhone`, `customerEmail`, `customerAddress`, and inside `VehicleFields`'s props — `defaultYear`, `defaultMake`, `defaultModel` — plus `vehicleColor`, `vehicleMileage`, `vehicleVin`) to the three-way chain, e.g.:

```tsx
defaultValue={applied?.customerName ?? imported?.customerName ?? job?.customerName ?? ''}
```

Apply the same `applied?.X ?? imported?.X ?? job?.X` pattern to all of: `customerPhone`, `customerEmail`, `customerAddress`, `vehicleColor`, `vehicleMileage`, `vehicleVin`, and the three `VehicleFields` props (`defaultYear`, `defaultMake`, `defaultModel`). `VehicleFields` needs no internal changes — its existing `isKnownMake`/`isKnownModel` lazy-init logic already routes an unmatched value into free-text mode, and `imported.vehicleMake`/`.vehicleModel` are already normalized by `mapExtractedToPrefill` (Task 5) before they ever reach here.

Add the same `key={formVersion}` to **both** `LineEditor` instances (labour and parts — currently unkeyed):

**Note:** `ImportLabourLine`/`ImportPartLine` (plain `{description: string; hours: string}`-shaped
objects) are not directly assignable to `LineEditor`'s `initial: Record<string, string>[]` prop —
TypeScript requires an explicit index signature, so a bare object type without one needs mapping
even though every field is already a string. Map explicitly, the same way the existing `job?.X`
branch already does:

```tsx
<LineEditor
  key={formVersion}
  name="labourLines"
  ...
  initial={
    imported && imported.labourLines.length > 0
      ? imported.labourLines.map((l): Record<string, string> => ({ description: l.description, hours: l.hours }))
      : (job?.labourLines ?? []).map((l): Record<string, string> => ({ description: l.description, hours: l.hours }))
  }
  ...
/>
```

and

```tsx
<LineEditor
  key={formVersion}
  name="parts"
  ...
  initial={
    imported && imported.parts.length > 0
      ? imported.parts.map((p): Record<string, string> => ({ partName: p.partName, partNumber: p.partNumber, qty: p.qty, unitPrice: p.unitPrice }))
      : (job?.parts ?? []).map((p): Record<string, string> => ({ partName: p.partName, partNumber: p.partNumber, qty: p.qty, unitPrice: p.unitPrice }))
  }
  ...
/>
```

- [ ] **Step 5: Auto-expand sections an import actually populated**

The "Work and labour" `<Section>` currently reads `defaultOpen={!isNew}`. Change to:

```tsx
defaultOpen={!isNew || (imported?.labourLines?.length ?? 0) > 0}
```

The "Scheduling and notes" `<Section>` currently has **no** `defaultOpen` prop at all (always collapsed — confirmed by reading the file directly, not assumed). Give it one:

```tsx
<Section
  title="Scheduling and notes"
  defaultOpen={Boolean(imported?.dueDate || imported?.dueTime || imported?.otherComments || imported?.notes)}
>
```

"Parts" already reads `defaultOpen={!isNew && partsSummary.count > 0}` — leave this line completely unchanged. Once Step 2's recompute effect lands, `partsSummary.count` reflects an import correctly with no special-casing needed here.

This is safe as a plain reactive prop, not a `key` trick — `<details open={...}>` (inside `Section`) is a normal DOM attribute React re-applies every render, unlike `defaultValue`. `imported` flips false→true exactly once and never fights a user's manual toggle afterward.

- [ ] **Step 6: Extend `otherComments`/`notes` defaultValues**

```tsx
defaultValue={imported?.otherComments ?? job?.otherComments ?? ''}
```
```tsx
defaultValue={imported?.notes ?? job?.notes ?? ''}
```

(No `applied?.` here — the registration-lookup `Prefill` type never carries these two fields, so only `imported`/`job` are relevant.)

- [ ] **Step 7: Typecheck**

```bash
pnpm typecheck 2>&1 | tail -30
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add components/jobs/job-form.tsx
git commit -m "feat: JobForm applies a stashed import prefill on mount"
```

---

## Task 10: The choice modal, entry-point wiring, env var, and full verification

**Files:**
- Create: `components/jobs/new-job-modal.tsx`
- Modify: `app/(dashboard)/jobs/page.tsx`
- Modify: `app/(dashboard)/schedule/page.tsx`
- Modify: `.env.example`
- Test: none automated (client-only UI, no RTL) — full manual checklist below.

**Interfaces:**
- Consumes: `IMPORT_PREFILL_KEY` from `components/jobs/job-form.tsx`, `/api/import/upload-url` and `/api/import/parse` (Tasks 7, 8).
- Produces: `NewJobButton` — drop-in replacement for `<LinkButton href="/jobs/new">New job</LinkButton>`.

- [ ] **Step 1: Add the env var placeholder**

In `.env.example`, add a new section (matching the file's existing per-section style — find where the R2/File storage section is and add this as a sibling section, not inside it):

```bash
# AI import (OpenRouter) — used to parse a screenshot, markdown note, or
# voice recording into job fields on "New job" -> Import.
OPENROUTER_API_KEY=
```

- [ ] **Step 2: Build the modal component**

Create `components/jobs/new-job-modal.tsx`:

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button, Textarea } from '@/components/ui';
import { IMPORT_PREFILL_KEY } from '@/components/jobs/job-form';
import type { ImportKind } from '@/lib/import/schema';

type Stage =
  | { kind: 'choice' }
  | { kind: 'markdown'; text: string }
  | { kind: 'screenshot'; file: File | null; storagePath?: string }
  | { kind: 'voice'; blob: Blob | File | null; storagePath?: string; recording: boolean }
  | { kind: 'busy'; label: string }
  | { kind: 'error'; message: string; back: Stage }
  | { kind: 'empty'; back: Stage };

const ACCEPTED_RECORD_MIME_CANDIDATES = ['audio/mp4', 'audio/aac', 'audio/ogg;codecs=opus'];

function pickSupportedMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null;
  return ACCEPTED_RECORD_MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? null;
}

async function uploadToR2(file: File | Blob, fileName: string, mimeType: string): Promise<string> {
  const res = await fetch('/api/import/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, mimeType }),
  });
  const body = (await res.json()) as { uploadUrl?: string; storagePath?: string; error?: string };
  if (!res.ok || !body.uploadUrl || !body.storagePath) {
    throw new Error(body.error ?? 'Could not start the upload.');
  }

  const put = await fetch(body.uploadUrl, { method: 'PUT', body: file });
  if (!put.ok) throw new Error('Upload failed — check your connection and try again.');

  return body.storagePath;
}

async function parseImport(
  payload:
    | { kind: 'markdown'; text: string }
    | { kind: 'screenshot' | 'voice'; storagePath: string; mimeType: string },
): Promise<{ prefill: unknown; empty: boolean }> {
  const res = await fetch('/api/import/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as { ok?: boolean; prefill?: unknown; empty?: boolean; error?: string };
  if (!res.ok || !body.ok) {
    throw new Error(body.error ?? 'Could not read that import.');
  }
  return { prefill: body.prefill, empty: Boolean(body.empty) };
}

/**
 * Drop-in replacement for `<LinkButton href="/jobs/new">New job</LinkButton>`.
 * Follows `MarkPaidModal`'s hand-rolled `<div role="dialog">` shape
 * (`components/payments/mark-paid-modal.tsx`) — but unlike that modal (a
 * deliberate hard stop with no Escape/backdrop-close), this one adds both:
 * nothing here is destructive until the owner explicitly submits the real
 * job form, which this modal never renders itself — every path ends at
 * `/jobs/new`, imported data landing there via `sessionStorage`.
 */
export function NewJobButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<Stage>({ kind: 'choice' });
  const abortRef = useRef<AbortController | null>(null);

  function close() {
    abortRef.current?.abort();
    setOpen(false);
    setStage({ kind: 'choice' });
  }

  function scratch() {
    sessionStorage.removeItem(IMPORT_PREFILL_KEY);
    router.push('/jobs/new');
    close();
  }

  async function runImport(
    kind: ImportKind,
    upload: { file: File | Blob; fileName: string; mimeType: string } | null,
    text: string | undefined,
    back: Stage,
  ) {
    abortRef.current = new AbortController();
    try {
      let storagePath: string | undefined;
      if (upload) {
        setStage({ kind: 'busy', label: 'Uploading…' });
        storagePath = await uploadToR2(upload.file, upload.fileName, upload.mimeType);
      }

      setStage({ kind: 'busy', label: 'Reading…' });
      const { prefill, empty } =
        kind === 'markdown'
          ? await parseImport({ kind: 'markdown', text: text! })
          : await parseImport({ kind, storagePath: storagePath!, mimeType: upload!.mimeType });

      if (empty) {
        setStage({ kind: 'empty', back });
        return;
      }

      sessionStorage.setItem(IMPORT_PREFILL_KEY, JSON.stringify(prefill));
      router.push('/jobs/new');
      close();
    } catch (error) {
      setStage({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Could not read that import.',
        back,
      });
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)} className="shrink-0">
        New job
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New job"
        className="w-full max-w-md rounded-lg border border-line bg-surface p-4 shadow-lg"
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">New job</h2>
          <Button variant="ghost" size="sm" onClick={close} aria-label="Close">
            Close
          </Button>
        </div>

        {stage.kind === 'choice' ? (
          <div className="flex flex-col gap-1.5">
            <Button onClick={scratch}>Create from scratch</Button>
            <Button variant="secondary" onClick={() => setStage({ kind: 'screenshot', file: null })}>
              Import from screenshot
            </Button>
            <Button variant="secondary" onClick={() => setStage({ kind: 'markdown', text: '' })}>
              Import from markdown
            </Button>
            <Button
              variant="secondary"
              onClick={() => setStage({ kind: 'voice', blob: null, recording: false })}
            >
              Import from voice recording
            </Button>
          </div>
        ) : null}

        {stage.kind === 'markdown' ? (
          <div className="flex flex-col gap-2">
            <Textarea
              rows={8}
              placeholder="Paste notes, or paste the contents of a markdown file…"
              value={stage.text}
              onChange={(e) => setStage({ kind: 'markdown', text: e.target.value })}
            />
            <div className="flex gap-2">
              <Button
                onClick={() => runImport('markdown', null, stage.text, stage)}
                disabled={stage.text.trim() === ''}
              >
                Import
              </Button>
              <Button variant="ghost" onClick={() => setStage({ kind: 'choice' })}>
                ← Back
              </Button>
            </div>
          </div>
        ) : null}

        {stage.kind === 'screenshot' ? (
          <div className="flex flex-col gap-2">
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setStage({ kind: 'screenshot', file: e.target.files?.[0] ?? null })}
            />
            {stage.file ? (
              // eslint-disable-next-line @next/next/no-img-element -- transient local preview, never a persisted asset
              <img
                src={URL.createObjectURL(stage.file)}
                alt="Selected screenshot"
                className="max-h-48 rounded-md border border-line object-contain"
              />
            ) : null}
            <div className="flex gap-2">
              <Button
                onClick={() =>
                  stage.file &&
                  runImport(
                    'screenshot',
                    { file: stage.file, fileName: stage.file.name, mimeType: stage.file.type },
                    undefined,
                    stage,
                  )
                }
                disabled={!stage.file}
              >
                Import
              </Button>
              <Button variant="ghost" onClick={() => setStage({ kind: 'choice' })}>
                ← Back
              </Button>
            </div>
          </div>
        ) : null}

        {stage.kind === 'voice' ? (
          <VoiceCapture
            stage={stage}
            onChange={setStage}
            onImport={(blob, mimeType) =>
              runImport('voice', { file: blob, fileName: `voice.${mimeType.split('/')[1]}`, mimeType }, undefined, stage)
            }
            onBack={() => setStage({ kind: 'choice' })}
          />
        ) : null}

        {stage.kind === 'busy' ? <p className="text-sm text-muted">{stage.label}</p> : null}

        {stage.kind === 'error' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-danger">{stage.message}</p>
            <div className="flex gap-2">
              <Button onClick={() => setStage(stage.back)}>Try again</Button>
              <Button variant="ghost" onClick={scratch}>
                Create from scratch instead
              </Button>
            </div>
          </div>
        ) : null}

        {stage.kind === 'empty' ? (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted">Couldn&rsquo;t find any job details in that.</p>
            <div className="flex gap-2">
              <Button onClick={() => setStage(stage.back)}>Try again</Button>
              <Button variant="ghost" onClick={scratch}>
                Create from scratch instead
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Two capture affordances shown together, not one — Chrome's MediaRecorder
 * default (`audio/webm`) isn't on OpenRouter's accepted audio-format list, so
 * live recording is offered only when a supported container is available,
 * and a plain file upload is always offered as well, covering both a browser
 * that can't record in an accepted format and an owner who already has a
 * memo from their phone's own recorder.
 */
function VoiceCapture({
  stage,
  onChange,
  onImport,
  onBack,
}: {
  stage: Extract<Stage, { kind: 'voice' }>;
  onChange: (stage: Stage) => void;
  onImport: (blob: Blob, mimeType: string) => void;
  onBack: () => void;
}) {
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const supportedMimeType = pickSupportedMimeType();

  async function startRecording() {
    if (!supportedMimeType) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream, { mimeType: supportedMimeType });
    chunksRef.current = [];
    recorder.ondataavailable = (e) => chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: supportedMimeType });
      onChange({ kind: 'voice', blob, recording: false });
      stream.getTracks().forEach((track) => track.stop());
    };
    recorder.start();
    recorderRef.current = recorder;
    onChange({ kind: 'voice', blob: null, recording: true });
  }

  function stopRecording() {
    recorderRef.current?.stop();
  }

  return (
    <div className="flex flex-col gap-2">
      {supportedMimeType ? (
        <Button variant="secondary" onClick={stage.recording ? stopRecording : startRecording}>
          {stage.recording ? 'Stop recording' : 'Record'}
        </Button>
      ) : null}

      <label className="text-xs text-muted">
        {supportedMimeType ? 'or upload a voice recording' : 'Upload a voice recording'}
        <input
          type="file"
          accept="audio/*"
          className="mt-1 block"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onChange({ kind: 'voice', blob: file, recording: false });
          }}
        />
      </label>

      {stage.blob ? (
        // eslint-disable-next-line jsx-a11y/media-has-caption -- transient local preview, never persisted
        <audio controls src={URL.createObjectURL(stage.blob)} />
      ) : null}

      <div className="flex gap-2">
        <Button
          onClick={() => stage.blob && onImport(stage.blob, stage.blob.type || 'audio/mp4')}
          disabled={!stage.blob}
        >
          Import
        </Button>
        <Button variant="ghost" onClick={onBack}>
          ← Back
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Wire both entry points**

In `app/(dashboard)/jobs/page.tsx`, replace the import and usage:

```ts
// Remove: LinkButton import if it becomes otherwise unused in this file — check first.
import { NewJobButton } from '@/components/jobs/new-job-modal';
```

```tsx
<NewJobButton />
```

replacing the existing `<LinkButton href="/jobs/new">New job</LinkButton>` at line 45. Do the same in `app/(dashboard)/schedule/page.tsx` at line 202. In both files, check whether `LinkButton` is still used elsewhere in the file (e.g. for other links) before removing its import — only drop the import if this was its last use.

- [ ] **Step 4: Typecheck and lint**

```bash
pnpm typecheck 2>&1 | tail -30
pnpm lint 2>&1 | tail -30
```

Expected: zero errors on both. Fix any unescaped-entity or unused-import lint errors the same way prior sessions in this project have (e.g. `&rsquo;` for a literal apostrophe in JSX text).

- [ ] **Step 5: Full automated test suite**

```bash
pnpm test --run 2>&1 | tail -30
```

Expected: all tests pass, including every new one from Tasks 1–7.

- [ ] **Step 6: Manual verification — the whole flow, in a real browser**

Using the dedicated `claude-chrome` CDP profile (never `launch()`/`launchPersistentContext()` against it), with `OPENROUTER_API_KEY` set in `.env.local` and the dev server running:

1. Click "New job" from the Jobs page — modal opens with 4 options.
2. Click "New job" from the Schedule page — same modal.
3. **Create from scratch**: lands on `/jobs/new`, completely blank, identical to today's behavior.
4. **Markdown import**: paste a realistic note ("Sarah Doyle, 251-WX-1001, Toyota Corolla, front brake pads, about 2.5 hours") → Import → lands on `/jobs/new` with Customer/Vehicle pre-filled, **Work and labour already expanded** showing the brake job line, **Total hours / Labour total showing the real numbers immediately** (not €0.00 until a row is touched — this is the specific gap Task 9 Step 2 exists to close).
5. **Screenshot import**: a real photo of a written/typed note → same checks.
6. **Voice import**: record a short description on both desktop Chrome and, if available, iOS Safari specifically — confirm the record button either works or is absent with the file-upload fallback still present; try the fallback file-upload path too.
7. **Bad input per kind**: a blurry/irrelevant photo, a silent recording, an off-topic paste — confirm the "Couldn't find any job details" state appears, not a fabricated-looking form.
8. **After a successful import**, on the pre-filled `/jobs/new` page, type a plate into Vehicle registration that matches a real previous job and tap "Use these details" — confirm the registration-match fields override correctly while the import-only fields (dueDate, notes, labour/parts lines) are untouched.
9. Confirm no `job_attachments` row was created for any screenshot/voice import (check the job's Attachments section after creating it, or query the DB directly) and that the R2 object under `imports/` is gone afterward.
10. Send 11 import requests inside 10 minutes (any kind) — confirm the 11th shows the rate-limit error, not a raw 429/crash.

- [ ] **Step 7: Changelog**

Fresh timestamp — never reuse one:

```bash
TZ=Europe/Dublin date "+%d/%m/%Y @ %H:%M:%S IST"
```

Add the entry at **line 2** of `CHANGELOG.md`, directly after `# Changelog`, pushing all existing entries down. It must open with `**Project completion: xx.xx%**` derived from a real count (e.g. "10 of 10 plan tasks shipped"), and cover Goal, Added (with cause/reasoning and verification), and Files Touched — explaining *why*, not just what. Confirm the model string with the user before committing.

- [ ] **Step 8: Commit and push**

```bash
git add -A && git status --short
git commit -m "feat: New job import from screenshot, markdown, or voice via OpenRouter"
git push origin main
git log --oneline -5
```

Confirm the working tree is clean afterward, including untracked files.
