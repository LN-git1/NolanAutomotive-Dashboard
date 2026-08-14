import { defineCloudflareConfig } from '@opennextjs/cloudflare';

/**
 * OpenNext adapter config for Cloudflare Workers.
 *
 * Deliberately minimal. The incremental cache override is not configured
 * because every page in this app is `force-dynamic` — it is a single-user
 * dashboard where every view must reflect the current state of the workshop,
 * so there is nothing to cache and an R2-backed cache would only add a
 * dependency for no benefit.
 */
export default defineCloudflareConfig();
