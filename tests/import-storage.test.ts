import { describe, expect, it } from 'vitest';

import { buildImportPath } from '@/lib/storage/signedUrl';

describe('buildImportPath', () => {
  it('prefixes with imports/ and a uuid, sanitising the filename', () => {
    const path = buildImportPath('My Photo (1).jpeg');
    expect(path).toMatch(/^imports\/[0-9a-f-]{36}-My_Photo_1_\.jpeg$/);
  });

  it('produces a different path on each call', () => {
    const a = buildImportPath('note.md');
    const b = buildImportPath('note.md');
    expect(a).not.toBe(b);
  });
});
