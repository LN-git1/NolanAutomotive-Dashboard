import { z } from 'zod';

import { requireApiSession } from '@/lib/auth/require-session';
import { readSmallJson } from '@/lib/push/body';
import { sendPushToEndpoint } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({ endpoint: z.string().max(2048) });

/**
 * "Send a test": one notification to the device that asked. Only an endpoint
 * that is already registered is ever used (see `sendPushToEndpoint`), so this
 * cannot be pointed at an address of someone's choosing.
 */
export async function POST(request: Request) {
  const denied = await requireApiSession();
  if (denied) return denied;

  const parsed = schema.safeParse(await readSmallJson(request));
  if (!parsed.success) {
    return Response.json({ error: 'Invalid request' }, { status: 400 });
  }

  const result = await sendPushToEndpoint(parsed.data.endpoint, {
    title: 'Notifications are working',
    body: 'This is a test from the Nolan Automotive dashboard.',
    url: '/settings',
    tag: 'test',
  });

  if (!result.configured) {
    return Response.json({ ok: false, error: 'Notifications are not set up yet' }, { status: 503 });
  }
  if (result.attempted === 0) {
    return Response.json({ ok: false, error: 'This device is not registered. Switch notifications off and on again.' }, { status: 404 });
  }

  return Response.json({ ok: result.delivered > 0, ...result });
}
