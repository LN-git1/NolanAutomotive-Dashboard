import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { assertCredentialsConfigured, checkCredentials } from '@/lib/auth/credentials';
import { createSessionToken, verifySessionToken } from '@/lib/auth/session';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe('checkCredentials', () => {
  beforeEach(() => {
    process.env.ADMIN_USERNAME = 'owner';
    process.env.ADMIN_PASSWORD = 'correct-horse-battery-staple';
  });

  it('accepts the configured credentials', () => {
    expect(checkCredentials('owner', 'correct-horse-battery-staple')).toBe(true);
  });

  it('rejects a wrong password of the SAME length', () => {
    expect(checkCredentials('owner', 'correct-horse-battery-stapla')).toBe(false);
  });

  /**
   * The regression this whole design exists for: `timingSafeEqual` throws on
   * buffers of unequal length, so comparing raw strings would crash on almost
   * every failed login. Hashing both sides first makes the lengths always
   * equal, so this must return false rather than throw.
   */
  it('rejects a wrong password of a DIFFERENT length without throwing', () => {
    expect(() => checkCredentials('owner', 'x')).not.toThrow();
    expect(checkCredentials('owner', 'x')).toBe(false);

    expect(() => checkCredentials('owner', 'y'.repeat(500))).not.toThrow();
    expect(checkCredentials('owner', 'y'.repeat(500))).toBe(false);
  });

  it('rejects a wrong username of a different length', () => {
    expect(() => checkCredentials('a', 'correct-horse-battery-staple')).not.toThrow();
    expect(checkCredentials('a', 'correct-horse-battery-staple')).toBe(false);
  });

  it('rejects empty input', () => {
    expect(checkCredentials('', '')).toBe(false);
  });

  it('fails closed when the environment is not configured', () => {
    delete process.env.ADMIN_USERNAME;
    delete process.env.ADMIN_PASSWORD;

    expect(checkCredentials('owner', 'correct-horse-battery-staple')).toBe(false);
    expect(() => assertCredentialsConfigured()).toThrow();
  });
});

describe('session tokens', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'a'.repeat(48);
  });

  it('accepts a token it just issued', async () => {
    const token = await createSessionToken();
    await expect(verifySessionToken(token)).resolves.toBe(true);
  });

  it('rejects a tampered token', async () => {
    const token = await createSessionToken();
    const tampered = `${token.slice(0, -3)}abc`;

    await expect(verifySessionToken(tampered)).resolves.toBe(false);
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await createSessionToken();

    process.env.SESSION_SECRET = 'b'.repeat(48);
    await expect(verifySessionToken(token)).resolves.toBe(false);
  });

  it('rejects missing and malformed tokens', async () => {
    await expect(verifySessionToken(undefined)).resolves.toBe(false);
    await expect(verifySessionToken(null)).resolves.toBe(false);
    await expect(verifySessionToken('')).resolves.toBe(false);
    await expect(verifySessionToken('not-a-jwt')).resolves.toBe(false);
  });

  it('refuses to sign with a secret that is too short to be safe', async () => {
    process.env.SESSION_SECRET = 'short';
    await expect(createSessionToken()).rejects.toThrow(/SESSION_SECRET/);
  });
});
