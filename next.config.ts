import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The invoice template and the embedded fonts are read from disk at runtime
   * by `lib/pdf/stamp.ts`. Next.js output file tracing cannot see those reads
   * (the paths are built with `path.join`, not statically imported), so without
   * this they are omitted from the serverless bundle and invoice generation
   * fails in production with ENOENT while working perfectly in local dev.
   */
  outputFileTracingIncludes: {
    '/api/invoices/**': [
      './lib/pdf/template/**',
      './lib/pdf/fonts/**',
    ],
  },

  serverExternalPackages: ['pdf-lib', '@pdf-lib/fontkit'],
};

export default nextConfig;
