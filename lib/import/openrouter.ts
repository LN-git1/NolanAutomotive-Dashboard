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
