import { requireApiSession } from '@/lib/auth/require-session';
import { readVapidConfig } from '@/lib/push/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The public half of the push key, which the browser needs to subscribe.
 *
 * Read from the environment at request time rather than baked into the page,
 * so the key can be set (or changed) without a rebuild, and nothing here ever
 * touches the database. 503 means "notifications are not set up yet", which the
 * Settings card shows as a plain message rather than an error.
 */
export async function GET() {
  const denied = await requireApiSession();
  if (denied) return denied;

  const config = readVapidConfig();
  if (!config) {
    return Response.json({ error: 'Notifications are not set up yet' }, { status: 503 });
  }

  return Response.json({ publicKey: config.publicKey });
}
