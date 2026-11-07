import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import manifest from '@/app/manifest';
import { config } from '@/proxy';

const ROOT = path.join(__dirname, '..');
const PUBLIC_DIR = path.join(ROOT, 'public');

/** Width, height and colour type straight from a PNG's header (colour type 2 = RGB, 6 = RGBA). */
function pngInfo(file: string) {
  const buf = readFileSync(file);
  expect(buf.subarray(1, 4).toString('ascii')).toBe('PNG');
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colorType: buf[25] };
}

describe('Home Screen icons (why iOS showed a plain letter)', () => {
  it('serves the Home Screen icon as an opaque 180x180 PNG', () => {
    const info = pngInfo(path.join(PUBLIC_DIR, 'icons/v2/apple-touch-icon.png'));
    expect(info).toMatchObject({ width: 180, height: 180, colorType: 2 });
  });

  it('keeps the app icons opaque and the right size', () => {
    for (const [file, size] of [
      ['icons/v2/icon-192.png', 192],
      ['icons/v2/icon-512.png', 512],
      ['icons/v2/icon-maskable-512.png', 512],
    ] as const) {
      expect(pngInfo(path.join(PUBLIC_DIR, file)), file).toMatchObject({ width: size, height: size, colorType: 2 });
    }
  });

  it('points every manifest icon at a file that exists', () => {
    for (const icon of manifest().icons ?? []) {
      expect(existsSync(path.join(PUBLIC_DIR, icon.src)), icon.src).toBe(true);
    }
  });

  it('uses a new versioned folder, so a device that cached the old icons has to fetch these', () => {
    for (const icon of manifest().icons ?? []) {
      expect(icon.src.startsWith('/icons/v2/')).toBe(true);
    }
    expect(existsSync(path.join(PUBLIC_DIR, 'icons/apple-touch-icon.png'))).toBe(false);
  });

  it('has the root icon files iOS asks for when it ignores the <link> tag', () => {
    for (const file of ['apple-touch-icon.png', 'apple-touch-icon-precomposed.png']) {
      expect(pngInfo(path.join(PUBLIC_DIR, file)), file).toMatchObject({ width: 180, height: 180, colorType: 2 });
    }
  });

  it('leaves those root icon files outside the login gate', () => {
    const pattern = new RegExp(`^${config.matcher[0]}$`);
    for (const url of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/icons/v2/apple-touch-icon.png', '/favicon.ico']) {
      expect(pattern.test(url), `${url} must not be gated`).toBe(false);
    }
    // And the gate still covers real pages.
    expect(pattern.test('/jobs')).toBe(true);
  });

  it('versions the service worker cache and precaches the new icon, so no phone keeps the old one', () => {
    const sw = readFileSync(path.join(PUBLIC_DIR, 'sw.js'), 'utf8');
    expect(sw).toMatch(/const VERSION = 'v2';/);
    expect(sw).toContain("'/icons/v2/icon-192.png'");
    expect(sw).not.toMatch(/'\/icons\/icon-192\.png'/);
  });
});
