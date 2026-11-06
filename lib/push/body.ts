/**
 * Read a JSON request body, refusing anything larger than `maxBytes`.
 *
 * Every push route takes a handful of short fields, so a big body is never
 * legitimate. Checking the declared length first avoids reading it at all, and
 * the length of the text is checked again in case the header was missing or
 * wrong. Returns null for a body that is too big, empty, or not JSON.
 */
export async function readSmallJson(request: Request, maxBytes = 16 * 1024): Promise<unknown | null> {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;

  let text: string;
  try {
    text = await request.text();
  } catch {
    return null;
  }
  if (text.length > maxBytes) return null;

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
