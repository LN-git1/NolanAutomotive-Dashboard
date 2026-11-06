import { afterEach, describe, expect, it, vi } from 'vitest';

import { randomId } from '@/lib/client/uuid';

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => vi.unstubAllGlobals());

describe('randomId', () => {
  it('uses crypto.randomUUID when the browser has it', () => {
    vi.stubGlobal('crypto', {
      randomUUID: () => '11111111-2222-4333-8444-555555555555',
      getRandomValues: () => {
        throw new Error('should not be used');
      },
    });

    expect(randomId()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('falls back to a valid v4 UUID on an insecure page where randomUUID is missing', () => {
    const real = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (array: Uint8Array) => real.getRandomValues(array),
    });

    const ids = Array.from({ length: 50 }, () => randomId());

    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
