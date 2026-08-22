# New job: import from screenshot, markdown, or voice

**Date:** 2026-08-22
**Status:** Approved

## Problem

Every job today starts as a blank form filled in by hand — customer, vehicle, work lines — and
roughly 90% of that happens on a phone, often with dirty hands, mid-job. The owner wants a faster
path: a message/quote screenshot, a markdown note, or a spoken description should be able to
become a job without retyping everything that's already written or said down once.

## Decisions

Confirmed with the owner across three explicit choices:

1. **Provider: OpenRouter**, for all three import types. One API key, one OpenAI-compatible
   `/chat/completions` endpoint, vision and audio content blocks both supported — no separate
   provider or SDK per import type.
2. **Voice transcription runs through OpenRouter too**, not a dedicated Whisper-tier API and not
   a self-hosted local model. Handy.app (the owner's reference point) runs a model locally on a
   desktop machine; this app is phone-first and serverless (Vercel). A self-hosted Parakeet/NeMo
   server would add a new always-on paid service outside the current free-tier stack (Vercel +
   Supabase + R2) for a solo-run project; an in-browser WASM model would be slow and heavy on a
   phone and Parakeet/NeMo aren't distributed in browser-ready form today. OpenRouter's audio
   input (verified against their docs) accepts base64-encoded audio in the same chat-completions
   call used for the other two kinds — one mechanism, one provider, no new infrastructure.
3. **All three ship together in v1** — screenshot, markdown, and voice, not phased.

A fourth decision made without asking, because it's a correctness/safety issue rather than a
preference: **the extraction schema never asks the model for `status`, `hourlyRate`, or
`labourTotalOverride`.** `createJob` runs its input schema with no guard against a bare
`status: 'paid'` — that guard (see `2026-08-21-earnings-cash-basis-design.md`) only exists on the
*edit* path, `changeJobStatus`. An import that mapped to `status: 'paid'` would create a paid job
with no `payments` row behind it, i.e. the exact money-disappears-from-Earnings bug that spec
exists to prevent. Simplest fix: the model is never given the option.

## Design

### Flow

```
"New job" (2 entry points: Jobs page, Schedule page) → choice modal
  ├─ Create from scratch        → router.push('/jobs/new')                 [unchanged]
  ├─ Screenshot / voice import  → upload to R2 → parse route (fetch bytes,  [new]
  │                                base64, call OpenRouter) → prefill JSON
  └─ Markdown import            → parse route (text in the request body,   [new]
                                   no upload — always small) → prefill JSON

On success: stash prefill in sessionStorage → router.push('/jobs/new')
JobForm reads + clears it on mount, review-before-save unchanged.
```

Nothing is ever auto-saved. Every import path lands the owner on the same job form used today,
pre-filled, for review and correction before they hit Create — an imperfect extraction is safe
precisely because a human looks at it before it becomes a real job.

### Shared extraction

One lenient Zod schema (`lib/import/schema.ts`) and one prompt-builder (`lib/import/prompt.ts`)
serve all three kinds — they differ only in which OpenRouter content block gets attached to the
same instruction text: plain string for markdown, an `image_url` data-URI block for a screenshot,
an `input_audio` base64 block for voice. The audio path transcribes and extracts in one model
call, not two — OpenRouter's audio input works inside the same chat-completion request as text.

The schema mirrors `jobInputSchema`'s fields (customer/vehicle/labour lines/parts/scheduling) but
every field is optional — a photo or a ten-second voice note routinely won't supply everything,
and the form's own required-field validation still applies at actual submit time, unchanged.

### Upload path

Screenshot and voice recordings reuse the app's existing R2 presigned-upload pattern (the browser
PUTs bytes directly to R2, bypassing Vercel's ~1–4.5MB body-size limit entirely) — but through a
**new** upload route, not the existing job-attachment one, because that one requires a `jobId`
that doesn't exist yet at import time. The parse step then mints a short-lived signed GET URL,
fetches the bytes server-side, and base64-encodes them into the OpenRouter request (OpenRouter's
audio input specifically requires base64, not a URL). These objects are never turned into
`job_attachments` rows — they're parsed once and best-effort deleted from R2 afterward.

### Landing the prefill on the form

`JobForm` already has the exact mechanism this needs, built for its registration-lookup "Use
these details" flow: a `key`-bump remount that makes uncontrolled `defaultValue` fields and the
`LineEditor`s re-read their initial values. Import extends the same mechanism — read the stashed
prefill in a `useEffect` on mount (not a lazy `useState` initializer, which would run during SSR
where `sessionStorage` doesn't exist and cause a hydration mismatch), then bump the same remount
key. One real gap the existing mechanism doesn't cover: the labour/parts running totals are
computed once at mount from `job` alone and never automatically recomputed on a `LineEditor`
remount (it only reports new totals on a user edit) — without an explicit fix, imported rows
would display correctly while "Labour total: €0.00" sits above them, wrong, until the owner
touches a row. The totals get their own recompute effect alongside the remount.

### Rate limiting

The parse endpoint calls a paid external API behind session auth only (single admin login, no
public signup) — the abuse surface is narrow, but a client bug or a leaked session shouldn't be
able to run up unbounded cost. A small new Postgres table (`import_parse_attempts`) backs a
single atomic `INSERT ... SELECT ... WHERE (count in window) < threshold RETURNING id` check,
admitting or rejecting before any OpenRouter call runs — no new infrastructure (no Redis/KV),
consistent with this app's Postgres-only stack.

## Out of scope

- **Exact OpenRouter model IDs.** Chosen at implementation time against OpenRouter's live model
  list, not fixed by research done today — the vision-capable and audio-capable model sets are
  different in size and neither is guaranteed to still be current by the time this is built.
- **A dedicated transcription-only step.** Voice goes straight to extraction; no intermediate
  "here's your transcript, edit it" screen. If accuracy turns out to need one, that's a later
  iteration once real usage shows whether it's actually needed.
- **Rate-limit thresholds are a proposed default (10/10 min, 60/day, global across kinds)**, not
  finalized — adjust once real usage patterns exist.
- **Cleanup/lifecycle rule for orphaned import uploads in R2.** They're deleted best-effort right
  after parsing; a bucket-level lifecycle rule to catch anything that fails to delete is a cheap
  follow-up, not core scope.

## Success criteria

- Clicking "New job" from either entry point opens the choice modal; "Create from scratch" is
  pixel-for-pixel today's behavior.
- A real screenshot, a real markdown note, and a real voice recording (each tried once with a
  genuinely bad input too — blurry photo, silent recording, off-topic text) all either land the
  owner on a correctly pre-filled job form or show a clear "couldn't read that" state with no
  data loss and no silently-invented values.
- The pre-filled form's Total hours / Labour total / Parts total are correct on first paint, not
  €0.00 until a row is touched.
- No import path can ever produce a job whose status is `paid` without a real payment behind it.
- Nothing in the app changes for a job created "from scratch" — same form, same fields, same
  validation, same `createJob` action, unchanged.
