import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const css = readFileSync(path.join(__dirname, '..', 'app', 'globals.css'), 'utf8');

/** Every innermost `selector { declarations }` rule, whatever at-rule wraps it. */
function rules(source: string): { selector: string; body: string }[] {
  const found: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(pattern)) {
    found.push({ selector: match[1].trim(), body: match[2] });
  }
  return found;
}

describe('translucent bars', () => {
  it('never put a backdrop blur on the header element itself', () => {
    // The slide-out menu is position:fixed and lives inside the header. A
    // backdrop-filter on the header makes the header its containing block, so
    // the menu was clipped to the header's 48px height on iPhones. The blur
    // belongs on the header's ::before background layer.
    const offenders = rules(css).filter(
      ({ selector, body }) =>
        selector.includes('[data-chrome="header"]') &&
        !selector.includes('::before') &&
        /backdrop-filter:\s*(?!none)\S/.test(body),
    );

    expect(offenders).toEqual([]);
  });

  it('blurs the header through its background layer instead', () => {
    const layer = rules(css).filter(
      ({ selector, body }) =>
        selector.includes('[data-chrome="header"]::before') && /backdrop-filter:\s*saturate/.test(body),
    );

    expect(layer.length).toBeGreaterThan(0);
  });
});
