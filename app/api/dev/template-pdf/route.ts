import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { requireApiSession } from '@/lib/auth/require-session';

export const runtime = 'nodejs';

/**
 * Serves the raw template PDF to the Template Mapper canvas.
 *
 * The template lives in `lib/`, not `public/`, precisely so it is never a
 * publicly fetchable asset. This route is the only way to read it over HTTP and
 * it is gated twice: by the session check, and by TEMPLATE_MAPPER — which is
 * never enabled in production.
 */
export async function GET() {
  if (process.env.TEMPLATE_MAPPER !== 'true') {
    return new Response('Not found', { status: 404 });
  }

  const denied = await requireApiSession();
  if (denied) return denied;

  const bytes = await readFile(
    path.join(process.cwd(), 'lib/pdf/template/invoice-template.pdf'),
  );

  return new Response(bytes as unknown as BodyInit, {
    headers: { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store' },
  });
}
