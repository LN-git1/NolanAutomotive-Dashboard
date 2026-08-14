import type { NextConfig } from 'next';

import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const nextConfig: NextConfig = {
  /**
   * No `outputFileTracingIncludes` here any more.
   *
   * It used to bundle the invoice template and fonts so `lib/pdf/stamp.ts`
   * could read them from disk. Those now come from R2 (`lib/pdf/assets.ts`),
   * because Cloudflare Workers has no filesystem and whether traced files
   * survive into a Worker bundle is undocumented — exactly the kind of thing
   * that works in dev and fails in production on the most important code path.
   */
  serverExternalPackages: ['pdf-lib', '@pdf-lib/fontkit'],
};

export default nextConfig;

/**
 * Makes Cloudflare bindings available during `next dev`, so local development
 * behaves like the deployed Worker rather than diverging from it.
 */
void initOpenNextCloudflareForDev();
