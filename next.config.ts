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

  /**
   * Baseline response headers. HSTS already comes from Vercel; these are the
   * rest of the cheap, break-nothing set for an app with no embeds, no
   * third-party frames and no need for camera/mic/location:
   * nosniff stops MIME confusion, DENY keeps the login page out of iframes
   * (clickjacking the password field), and the permissions policy switches off
   * sensors the PWA never asks for.
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), payment=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
