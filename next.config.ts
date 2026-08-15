import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * Deliberately no `outputFileTracingIncludes`.
   *
   * It used to bundle the invoice template and fonts so `lib/pdf/stamp.ts`
   * could read them from disk. Those now come from R2 (`lib/pdf/assets.ts`).
   *
   * That change was made while briefly targeting Cloudflare Workers, which has
   * no filesystem — but it is kept because it is simply better: the app has now
   * changed hosting target twice, and fetching its own assets from object
   * storage is what made that cheap. It works identically on Vercel, on
   * Workers, or on a plain Node server, with no platform-specific build config.
   */
  serverExternalPackages: ['pdf-lib', '@pdf-lib/fontkit'],
};

export default nextConfig;
