import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { SPLASH_SIZES, splashPath, splashStartupImages } from '@/lib/pwa/splash';

const PUBLIC_DIR = path.join(__dirname, '..', 'public');

describe('iOS launch screens', () => {
  it('has a light and a dark image on disk for every listed device size', () => {
    const missing: string[] = [];

    for (const [width, height, ratio] of SPLASH_SIZES) {
      for (const scheme of ['light', 'dark'] as const) {
        const file = splashPath(scheme, width, height, ratio);
        if (!existsSync(path.join(PUBLIC_DIR, file))) missing.push(file);
      }
    }

    expect(missing).toEqual([]);
  });

  it('never gives two sizes the same file (414x896 exists at 2x and 3x)', () => {
    const urls = splashStartupImages().map((image) => image.url);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it('gives every image exactly one explicit colour scheme, so no two ever match one device', () => {
    for (const image of splashStartupImages()) {
      expect(image.media).toContain('(orientation: portrait)');

      const isDarkImage = image.url.includes('/dark-');
      const expected = isDarkImage ? 'dark' : 'light';
      const other = isDarkImage ? 'light' : 'dark';

      expect(image.media).toContain(`(prefers-color-scheme: ${expected})`);
      expect(image.media).not.toContain(`(prefers-color-scheme: ${other})`);
    }
  });

  it('makes the light and dark media of one device size mutually exclusive', () => {
    const images = splashStartupImages();

    for (const [width, height, ratio] of SPLASH_SIZES) {
      const pair = images.filter((image) => image.url.endsWith(`${width}x${height}@${ratio}x.png`));
      expect(pair).toHaveLength(2);

      const schemes = pair.map((image) => /prefers-color-scheme: (\w+)/.exec(image.media)?.[1]);
      expect([...schemes].sort()).toEqual(['dark', 'light']);
    }
  });

  it('serves the launch images from /icons/, which proxy.ts leaves outside the login gate', () => {
    for (const image of splashStartupImages()) {
      expect(image.url.startsWith('/icons/')).toBe(true);
    }
  });
});
