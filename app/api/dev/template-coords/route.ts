import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { requireApiSession } from '@/lib/auth/require-session';
import { validateCoords, type TemplateCoords } from '@/lib/pdf/coords';

export const runtime = 'nodejs';

const COORDS_PATH = path.join(process.cwd(), 'lib/pdf/invoiceTemplateCoords.json');

/**
 * Persist the coordinate map produced by the Template Mapper.
 *
 * LOCAL DEVELOPMENT ONLY. This writes a file into the source tree, which a
 * serverless filesystem cannot do — a further reason TEMPLATE_MAPPER must never
 * be set in production. The resulting JSON is committed to git like any other
 * source file.
 */
export async function POST(request: Request) {
  if (process.env.TEMPLATE_MAPPER !== 'true') {
    return new Response('Not found', { status: 404 });
  }

  const denied = await requireApiSession();
  if (denied) return denied;

  const payload = (await request.json().catch(() => null)) as TemplateCoords | null;

  if (!payload || typeof payload !== 'object' || !payload.fields || !payload.pageSize) {
    return Response.json({ error: 'Invalid coordinates payload' }, { status: 400 });
  }

  try {
    // Reject unknown field keys before writing, so a bad map can never reach
    // the stamper.
    validateCoords(payload);

    const serialised = `${JSON.stringify(
      {
        _comment:
          'Written by the Template Mapper (TEMPLATE_MAPPER=true). Coordinates are PDF points, origin bottom-left, y = text baseline.',
        ...payload,
      },
      null,
      2,
    )}\n`;

    await writeFile(COORDS_PATH, serialised, 'utf8');

    return Response.json({ ok: true, path: 'lib/pdf/invoiceTemplateCoords.json' });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not save coordinates' },
      { status: 400 },
    );
  }
}
