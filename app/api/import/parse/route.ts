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
