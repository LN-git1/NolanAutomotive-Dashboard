import { describe, expect, it } from 'vitest';

import { buildExtractionPrompt, buildMessages, mapMimeToOpenRouterFormat } from '@/lib/import/prompt';

describe('buildExtractionPrompt', () => {
  it('never mentions status, hourlyRate, or labourTotalOverride', () => {
    // Regression guard for the exact safety issue this whole schema design
    // exists to avoid — the model must never be told these fields exist.
    for (const kind of ['screenshot', 'markdown', 'voice'] as const) {
      const prompt = buildExtractionPrompt(kind).toLowerCase();
      expect(prompt).not.toContain('hourlyrate');
      expect(prompt).not.toContain('labourtotaloverride');
      expect(prompt).not.toMatch(/\bstatus\b/);
    }
  });

  it('mentions JSON-only output for every kind', () => {
    for (const kind of ['screenshot', 'markdown', 'voice'] as const) {
      expect(buildExtractionPrompt(kind).toLowerCase()).toContain('json');
    }
  });
});

describe('buildMessages', () => {
  it('builds a plain string message for markdown', () => {
    const messages = buildMessages('markdown', { text: 'Oil change for Sarah Doyle' }) as Array<{
      role: string;
      content: unknown;
    }>;

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe('user');
    expect(typeof messages[0]!.content).toBe('string');
    expect(messages[0]!.content as string).toContain('Oil change for Sarah Doyle');
  });

  it('builds an image_url content block for a screenshot', () => {
    const messages = buildMessages('screenshot', { base64: 'AAAA', mimeType: 'image/png' }) as Array<{
      content: Array<{ type: string; image_url?: { url: string } }>;
    }>;

    const content = messages[0]!.content;
    expect(Array.isArray(content)).toBe(true);
    const imageBlock = content.find((block) => block.type === 'image_url');
    expect(imageBlock).toBeDefined();
    expect(imageBlock!.image_url!.url).toBe('data:image/png;base64,AAAA');
  });

  it('builds an input_audio content block for voice, with the mapped format', () => {
    const messages = buildMessages('voice', { base64: 'BBBB', mimeType: 'audio/mp4' }) as Array<{
      content: Array<{ type: string; input_audio?: { data: string; format: string } }>;
    }>;

    const content = messages[0]!.content;
    const audioBlock = content.find((block) => block.type === 'input_audio');
    expect(audioBlock).toBeDefined();
    expect(audioBlock!.input_audio).toEqual({ data: 'BBBB', format: 'm4a' });
  });
});

describe('mapMimeToOpenRouterFormat', () => {
  it('maps common audio mime types to OpenRouter-accepted formats', () => {
    expect(mapMimeToOpenRouterFormat('audio/mp4')).toBe('m4a');
    expect(mapMimeToOpenRouterFormat('audio/aac')).toBe('aac');
    expect(mapMimeToOpenRouterFormat('audio/mpeg')).toBe('mp3');
    expect(mapMimeToOpenRouterFormat('audio/wav')).toBe('wav');
    expect(mapMimeToOpenRouterFormat('audio/ogg')).toBe('ogg');
  });

  it('throws on an unsupported mime type rather than silently guessing', () => {
    expect(() => mapMimeToOpenRouterFormat('audio/webm')).toThrow();
  });
});
