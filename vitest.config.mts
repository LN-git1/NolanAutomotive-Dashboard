import path from 'node:path';

import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    /**
     * The TEST_DATABASE_URL-gated integration tests (awaiting-payment,
     * earnings, payments) share one real Postgres database and some of them
     * compare a global aggregate before and after a mutation. Under Vitest's
     * default cross-file parallelism, one file's insert/delete can land
     * inside another file's snapshot window and fail an assertion that has
     * nothing to do with it — reproduced directly: adding payments.test.ts
     * made awaiting-payment.test.ts's "still counts the job..." test fail
     * consistently, purely from running alongside it. Serial file execution
     * costs a fraction of a second on a suite this size and removes the
     * entire class of races rather than requiring every future DB test to
     * avoid a "before vs after" pattern.
     */
    fileParallelism: false,
  },
  resolve: {
    alias: {
      // `server-only` throws unless resolved under the react-server condition,
      // which the plain Node test runner does not set. Stubbing it lets server
      // modules be unit-tested directly without loosening the real guard.
      'server-only': path.resolve(root, 'tests/stubs/server-only.ts'),
      '@': root,
    },
  },
});
