import 'server-only';

import type { ImportKind } from './schema';

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
