import { describe, expect, it } from 'vitest';

import {
  clipToWidth,
  fitRowsUniformly,
  fitTextInBox,
  wrapText,
  type TextMeasurer,
} from '@/lib/pdf/textFit';

/**
 * Deterministic stand-in for a PDF font: every glyph is half the font size
 * wide. Real fonts are proportional, but the fitting logic only ever asks
 * "how wide is this string at this size", so a linear measurer exercises every
 * branch without depending on font metrics.
 */
const measurer: TextMeasurer = {
  widthOfTextAtSize: (text, size) => text.length * size * 0.5,
};

describe('wrapText', () => {
  it('returns nothing for empty input', () => {
    expect(wrapText('', measurer, 10, 100)).toEqual([]);
  });

  it('keeps text on one line when it fits', () => {
    // "hello world" = 11 chars * 10 * 0.5 = 55pt, well under 100.
    expect(wrapText('hello world', measurer, 10, 100)).toEqual(['hello world']);
  });

  it('wraps at word boundaries', () => {
    // Each word is 20pt at size 10; a 50pt box fits two words per line.
    const lines = wrapText('aaaa bbbb cccc dddd', measurer, 10, 50);
    expect(lines).toEqual(['aaaa bbbb', 'cccc dddd']);
  });

  it('honours explicit newlines as hard breaks', () => {
    expect(wrapText('one\ntwo', measurer, 10, 1000)).toEqual(['one', 'two']);
  });

  it('hard-breaks a single word longer than the box instead of overflowing', () => {
    // 20 chars at size 10 = 100pt; box is 25pt, so 5 chars per line.
    const lines = wrapText('a'.repeat(20), measurer, 10, 25);

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      expect(measurer.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(25);
    }
    expect(lines.join('')).toBe('a'.repeat(20));
  });

  it('terminates when even one character cannot fit', () => {
    // The guard against the infinite loop this function exists to prevent.
    const lines = wrapText('abcdef', measurer, 10, 1);
    expect(lines.join('')).toBe('abcdef');
  });
});

describe('fitTextInBox', () => {
  it('uses the preferred size when the text already fits', () => {
    const result = fitTextInBox('short', measurer, {
      fontSize: 10,
      minFontSize: 6,
      maxWidth: 200,
      maxHeight: 40,
    });

    expect(result.fontSize).toBe(10);
    expect(result.truncated).toBe(false);
    expect(result.lines).toEqual(['short']);
  });

  it('shrinks the font so the text fits the available height', () => {
    const text = 'word '.repeat(20).trim();

    const result = fitTextInBox(text, measurer, {
      fontSize: 12,
      minFontSize: 4,
      maxWidth: 100,
      maxHeight: 30,
    });

    expect(result.fontSize).toBeLessThan(12);
    expect(result.fontSize).toBeGreaterThanOrEqual(4);
    expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(30);
    expect(result.truncated).toBe(false);
  });

  it('never goes below the minimum font size', () => {
    const result = fitTextInBox('word '.repeat(200), measurer, {
      fontSize: 12,
      minFontSize: 8,
      maxWidth: 50,
      maxHeight: 20,
    });

    expect(result.fontSize).toBe(8);
  });

  it('clips with an ellipsis rather than overflowing when it cannot fit at all', () => {
    const result = fitTextInBox('word '.repeat(200), measurer, {
      fontSize: 12,
      minFontSize: 8,
      maxWidth: 50,
      maxHeight: 20,
    });

    expect(result.truncated).toBe(true);
    // The hard guarantee: what is returned always fits the box.
    expect(result.lines.length * result.lineHeight).toBeLessThanOrEqual(20);
    expect(result.lines.at(-1)).toContain('…');
  });

  it('always leaves at least one line even in an impossibly short box', () => {
    const result = fitTextInBox('some text here', measurer, {
      fontSize: 10,
      minFontSize: 9,
      maxWidth: 40,
      maxHeight: 1,
    });

    expect(result.lines.length).toBe(1);
  });

  it('treats an empty string as nothing to draw', () => {
    expect(fitTextInBox('', measurer, { fontSize: 10, minFontSize: 6, maxWidth: 50 }).lines).toEqual(
      [],
    );
  });
});

describe('fitRowsUniformly', () => {
  it('keeps the preferred size when every cell fits', () => {
    const size = fitRowsUniformly(
      [
        { text: 'ab', maxWidth: 100 },
        { text: 'cd', maxWidth: 100 },
      ],
      measurer,
      { fontSize: 9, minFontSize: 6 },
    );

    expect(size).toBe(9);
  });

  it('shrinks to the size demanded by the widest cell', () => {
    const size = fitRowsUniformly(
      [
        { text: 'ab', maxWidth: 100 },
        { text: 'a'.repeat(40), maxWidth: 100 },
      ],
      measurer,
      { fontSize: 9, minFontSize: 4 },
    );

    expect(size).toBeLessThan(9);
    expect(measurer.widthOfTextAtSize('a'.repeat(40), size)).toBeLessThanOrEqual(100);
  });

  it('ignores empty cells when choosing a size', () => {
    const size = fitRowsUniformly([{ text: '', maxWidth: 1 }], measurer, {
      fontSize: 9,
      minFontSize: 6,
    });

    expect(size).toBe(9);
  });
});

describe('clipToWidth', () => {
  it('leaves text that already fits untouched', () => {
    expect(clipToWidth('ab', measurer, 10, 100)).toBe('ab');
  });

  it('clips over-wide text down to the column width', () => {
    const clipped = clipToWidth('a'.repeat(50), measurer, 10, 40);

    expect(clipped).toContain('…');
    expect(measurer.widthOfTextAtSize(clipped, 10)).toBeLessThanOrEqual(40);
  });
});
