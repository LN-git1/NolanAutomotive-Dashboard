/**
 * Pure text-fitting helpers for PDF stamping.
 *
 * These functions are deliberately free of any pdf-lib import so they can be
 * unit-tested with a fake measurer. The only thing they need from a font is the
 * ability to measure a string at a size, which `TextMeasurer` captures — and
 * pdf-lib's `PDFFont` satisfies that shape structurally.
 *
 * The hard requirement these defend: stamped text must NEVER overflow its
 * bounding box on the invoice. See `fitTextInBox`.
 */

/** Structural subset of pdf-lib's PDFFont that we actually depend on. */
export interface TextMeasurer {
  widthOfTextAtSize(text: string, size: number): number;
}

export interface FitOptions {
  /** Starting (preferred) font size in points. */
  fontSize: number;
  /** Never shrink below this. */
  minFontSize: number;
  /** Box width in points. */
  maxWidth: number;
  /** Box height in points. Omit for single-line fields with no vertical bound. */
  maxHeight?: number;
  /** Multiplier applied to font size to get line pitch. */
  lineHeightFactor?: number;
  /** Step to shrink by on each failed attempt. */
  step?: number;
}

export interface FitResult {
  lines: string[];
  fontSize: number;
  lineHeight: number;
  /** True when the text had to be clipped even at `minFontSize`. */
  truncated: boolean;
}

const DEFAULT_LINE_HEIGHT_FACTOR = 1.15;
const DEFAULT_STEP = 0.5;
const ELLIPSIS = '…';

/**
 * Break a single over-long token (no spaces) into chunks that each fit maxWidth.
 * Guarantees forward progress — a character that cannot fit on its own is still
 * emitted, which prevents the infinite loop this function exists to avoid.
 */
function breakLongWord(
  word: string,
  measurer: TextMeasurer,
  fontSize: number,
  maxWidth: number,
): string[] {
  const chunks: string[] = [];
  let current = '';

  for (const char of word) {
    const candidate = current + char;
    if (current !== '' && measurer.widthOfTextAtSize(candidate, fontSize) > maxWidth) {
      chunks.push(current);
      current = char;
    } else {
      current = candidate;
    }
  }

  if (current !== '') chunks.push(current);
  return chunks.length > 0 ? chunks : [word];
}

/**
 * Greedy word wrap. Explicit newlines in the input are always honoured as hard
 * breaks; words longer than the box are hard-broken rather than allowed to bleed.
 */
export function wrapText(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  maxWidth: number,
): string[] {
  if (text === '') return [];
  if (maxWidth <= 0) return [text];

  const lines: string[] = [];

  for (const paragraph of text.split(/\r\n|\r|\n/)) {
    if (paragraph.trim() === '') {
      lines.push('');
      continue;
    }

    let current = '';

    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current === '' ? word : `${current} ${word}`;

      if (measurer.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
        current = candidate;
        continue;
      }

      // Candidate does not fit. Flush what we have, then place the word.
      if (current !== '') {
        lines.push(current);
        current = '';
      }

      if (measurer.widthOfTextAtSize(word, fontSize) <= maxWidth) {
        current = word;
      } else {
        const chunks = breakLongWord(word, measurer, fontSize, maxWidth);
        lines.push(...chunks.slice(0, -1));
        current = chunks[chunks.length - 1] ?? '';
      }
    }

    lines.push(current);
  }

  return lines;
}

/**
 * Wrap `text` to fit inside a box, shrinking the font as needed.
 *
 * Strategy: try the preferred size, shrink by `step` until it fits vertically or
 * we reach `minFontSize`. If it still does not fit at the floor, clip to the
 * number of lines that DO fit and mark the result `truncated` — the caller
 * decides whether that is acceptable or should be surfaced as a validation
 * error. Nothing is ever drawn outside the box.
 */
export function fitTextInBox(
  text: string,
  measurer: TextMeasurer,
  options: FitOptions,
): FitResult {
  const {
    fontSize,
    minFontSize,
    maxWidth,
    maxHeight,
    lineHeightFactor = DEFAULT_LINE_HEIGHT_FACTOR,
    step = DEFAULT_STEP,
  } = options;

  const startSize = Math.max(fontSize, minFontSize);

  if (text === '') {
    return { lines: [], fontSize: startSize, lineHeight: startSize * lineHeightFactor, truncated: false };
  }

  let size = startSize;

  while (size >= minFontSize) {
    const lines = wrapText(text, measurer, size, maxWidth);
    const lineHeight = size * lineHeightFactor;

    if (maxHeight === undefined || lines.length * lineHeight <= maxHeight) {
      return { lines, fontSize: size, lineHeight, truncated: false };
    }

    const next = Number((size - step).toFixed(4));
    if (next < minFontSize) break;
    size = next;
  }

  // Still overflowing at the smallest permitted size — clip to what fits.
  const lineHeight = minFontSize * lineHeightFactor;
  const lines = wrapText(text, measurer, minFontSize, maxWidth);
  const maxLines = maxHeight === undefined
    ? lines.length
    : Math.max(1, Math.floor(maxHeight / lineHeight));

  if (lines.length <= maxLines) {
    return { lines, fontSize: minFontSize, lineHeight, truncated: false };
  }

  const clipped = lines.slice(0, maxLines);
  const lastIndex = clipped.length - 1;
  clipped[lastIndex] = appendEllipsis(clipped[lastIndex] ?? '', measurer, minFontSize, maxWidth);

  return { lines: clipped, fontSize: minFontSize, lineHeight, truncated: true };
}

/** Trim a line until it plus an ellipsis fits within maxWidth. */
function appendEllipsis(
  line: string,
  measurer: TextMeasurer,
  fontSize: number,
  maxWidth: number,
): string {
  let candidate = line;

  while (
    candidate.length > 0 &&
    measurer.widthOfTextAtSize(candidate + ELLIPSIS, fontSize) > maxWidth
  ) {
    candidate = candidate.slice(0, -1);
  }

  return candidate + ELLIPSIS;
}

/**
 * Find one font size that lets EVERY supplied cell fit its column width, so a
 * table renders at a single uniform size rather than a ragged mix.
 * Cells are single-line by definition (table rows do not wrap).
 */
export function fitRowsUniformly(
  cells: { text: string; maxWidth: number }[],
  measurer: TextMeasurer,
  options: { fontSize: number; minFontSize: number; step?: number },
): number {
  const { fontSize, minFontSize, step = DEFAULT_STEP } = options;
  let size = Math.max(fontSize, minFontSize);

  while (size > minFontSize) {
    const allFit = cells.every(
      (cell) => cell.text === '' || measurer.widthOfTextAtSize(cell.text, size) <= cell.maxWidth,
    );
    if (allFit) return size;

    const next = Number((size - step).toFixed(4));
    if (next < minFontSize) break;
    size = next;
  }

  return minFontSize;
}

/** Truncate a single-line cell to its column width (used at the min size floor). */
export function clipToWidth(
  text: string,
  measurer: TextMeasurer,
  fontSize: number,
  maxWidth: number,
): string {
  if (text === '' || measurer.widthOfTextAtSize(text, fontSize) <= maxWidth) return text;
  return appendEllipsis(text, measurer, fontSize, maxWidth);
}
