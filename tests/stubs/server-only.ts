/**
 * Test stub for the `server-only` package.
 *
 * The real module throws when it is resolved outside a server context. Vitest
 * runs in plain Node, so it would throw for every server module under test.
 * Aliased in vitest.config.ts. The production guard is unaffected.
 */
export {};
