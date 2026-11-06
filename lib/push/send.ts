import 'server-only';

import { eq, inArray, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { pushSubscriptions, type PushSubscriptionRow } from '@/lib/db/schema';

import { isAllowedPushEndpoint } from './endpoints';
import type { PushPayload } from './payload';
import type { PushTopic } from './topics';

/**
 * Sends a notification to every device that has this topic switched on.
 *
 * This function never throws. Notifications are a courtesy on top of the real
 * work (saving a job, recording a payment), so nothing that goes wrong here —
 * VAPID keys not set up yet, the table not created yet, a push service being
 * down — may ever turn into a failed save. Every problem becomes a quiet
 * `configured: false` or a count in the result.
 */
export interface SendResult {
  /** False when the VAPID keys are not set, so nothing was attempted. */
  configured: boolean;
  attempted: number;
  delivered: number;
  /** Devices whose subscription had expired and were forgotten. */
  removed: number;
  failed: number;
}

const NOT_SENT: SendResult = { configured: false, attempted: 0, delivered: 0, removed: 0, failed: 0 };

interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/** The keys come from the environment; without all three, push is simply off. */
export function readVapidConfig(env: NodeJS.ProcessEnv = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** How long the push service should hold a message for a phone that is off. */
const TTL_SECONDS: Record<PushTopic, number> = {
  morning: 6 * 60 * 60,
  system: 6 * 60 * 60,
  assigned: 60 * 60,
  supplier: 60 * 60,
};

async function deliver(
  rows: PushSubscriptionRow[],
  payload: PushPayload,
  topic: PushTopic,
  config: VapidConfig,
): Promise<SendResult> {
  const webpush = (await import('web-push')).default;
  const body = JSON.stringify(payload);
  const dead: string[] = [];
  let delivered = 0;
  let failed = 0;

  await Promise.all(
    rows.map(async (row) => {
      // Re-checked at send time too: rows could predate the allowlist.
      if (!isAllowedPushEndpoint(row.endpoint)) {
        failed += 1;
        return;
      }
      try {
        await webpush.sendNotification(
          { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
          body,
          {
            TTL: TTL_SECONDS[topic],
            urgency: 'normal',
            vapidDetails: {
              subject: config.subject,
              publicKey: config.publicKey,
              privateKey: config.privateKey,
            },
          },
        );
        delivered += 1;
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (status === 404 || status === 410) {
          // The device uninstalled the app or turned notifications off.
          dead.push(row.id);
        } else {
          // 403 means our VAPID keys do not match the subscription: a setup
          // problem to fix, not a reason to forget the device.
          failed += 1;
          console.error(`[push] send failed (status ${status ?? 'none'})`);
        }
      }
    }),
  );

  if (dead.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, dead)).catch(() => undefined);
  }

  return { configured: true, attempted: rows.length, delivered, removed: dead.length, failed };
}

export async function sendPush(topic: PushTopic, payload: PushPayload): Promise<SendResult> {
  try {
    const config = readVapidConfig();
    if (!config) return NOT_SENT;

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(sql`${pushSubscriptions.topics} @> ARRAY[${topic}]::text[]`);

    return await deliver(rows, payload, topic, config);
  } catch (error) {
    console.error('[push] could not send:', error instanceof Error ? error.message : 'unknown error');
    return NOT_SENT;
  }
}

/**
 * Sends to one device only, for the "Send a test" button. Only an endpoint that
 * is already saved is accepted, so this cannot be pointed at an arbitrary URL.
 */
export async function sendPushToEndpoint(endpoint: string, payload: PushPayload): Promise<SendResult> {
  try {
    const config = readVapidConfig();
    if (!config) return NOT_SENT;

    const rows = await db
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, endpoint))
      .limit(1);

    return await deliver(rows, payload, 'system', config);
  } catch (error) {
    console.error('[push] could not send test:', error instanceof Error ? error.message : 'unknown error');
    return NOT_SENT;
  }
}
