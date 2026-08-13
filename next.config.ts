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
    /**
     * The Invoicer page imports from `lib/pdf/stamp` too. Today it only calls
     * `partsRowCapacity()`, which reads the bundled JSON and never touches
     * disk — so this entry is not strictly needed yet. It is here because the
     * day something on that page calls `stampInvoice`, the failure would be an
     * ENOENT in production on a page that works perfectly in dev.
     */
    '/invoicer': [
      './lib/pdf/template/**',
      './lib/pdf/fonts/**',
    ],
  },

  serverExternalPackages: ['pdf-lib', '@pdf-lib/fontkit'],
};

export default nextConfig;
