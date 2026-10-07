import 'server-only';

import { db } from '@/lib/db';
import { errorLog } from '@/lib/db/schema';

export type ErrorSource = 'action' | 'db' | 'health' | 'ui' | 'digest';

/**
 * Record a failure for the 3-hourly digest email.
 *
 * Never throws and never retries: it runs inside other failure paths, often
 * because the database is already struggling, so the worst outcome it is
 * allowed to have is silently recording nothing. The caller's own
 * `console.error` remains the durable signal. Bounded by a short timeout so a
 * stalled pooler cannot hold a request open.
 */
export async function recordError(entry: {
  source: ErrorSource;
  label: string;
  message: string;
  code?: string | null;
}): Promise<void> {
  try {
    await Promise.race([
      db.insert(errorLog).values({
        source: entry.source,
        label: entry.label.slice(0, 200),
        message: entry.message.slice(0, 1000),
        code: entry.code ? entry.code.slice(0, 40) : null,
      }),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 3000)),
    ]);
  } catch {
    // Best-effort by design.
  }
}
