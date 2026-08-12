import path from 'node:path';

import { defineConfig } from 'vitest/config';

const root = import.meta.dirname;

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
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
