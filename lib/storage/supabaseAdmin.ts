import 'server-only';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client. SERVER ONLY.
 *
 * This key bypasses every row-level policy, so it must never reach the browser.
 * The `server-only` import above turns an accidental client import into a build
 * error rather than a silent credential leak, and the key is deliberately NOT
 * prefixed with NEXT_PUBLIC_.
 *
 * Both buckets are private. Nothing is ever served from a public URL; the
 * browser only ever sees short-lived signed URLs minted here.
 */

export const ATTACHMENTS_BUCKET = 'attachments';
export const INVOICES_BUCKET = 'invoices';

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. See .env.example.',
    );
  }

  cached = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  return cached;
}
