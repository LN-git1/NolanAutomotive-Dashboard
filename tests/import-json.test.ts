import { describe, expect, it } from 'vitest';

import { extractJsonObject } from '@/lib/import/openrouter';

describe('extractJsonObject', () => {
  it('parses clean JSON', () => {
    expect(extractJsonObject('{"customerName":"Sarah Doyle"}')).toEqual({
      customerName: 'Sarah Doyle',
    });
  });

  it('strips a ```json fenced block', () => {
    const text = '```json\n{"customerName":"Sarah Doyle"}\n```';
    expect(extractJsonObject(text)).toEqual({ customerName: 'Sarah Doyle' });
  });

  it('strips a plain ``` fenced block with no language tag', () => {
    const text = '```\n{"customerName":"Sarah Doyle"}\n```';
    expect(extractJsonObject(text)).toEqual({ customerName: 'Sarah Doyle' });
  });

  it('tolerates stray prose before and after the JSON object', () => {
    const text = 'Here is the extracted job:\n{"customerName":"Sarah Doyle"}\nLet me know if you need more.';
    expect(extractJsonObject(text)).toEqual({ customerName: 'Sarah Doyle' });
  });

  it('throws a clear error on genuinely unparseable text', () => {
    expect(() => extractJsonObject('I could not find any job details in that image.')).toThrow(
      /could not/i,
    );
  });

  it('throws rather than silently returning an empty object on empty input', () => {
    expect(() => extractJsonObject('')).toThrow();
  });
});
