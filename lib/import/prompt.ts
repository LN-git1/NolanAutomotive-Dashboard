import 'server-only';

import type { ImportKind } from './schema';

const KIND_INTRO: Record<ImportKind, string> = {
  screenshot: 'You are looking at a screenshot of a message or note describing a car repair job.',
  markdown: 'You are reading a block of freeform notes describing a car repair job.',
  voice: "You are listening to a voice recording of a garage owner describing a car repair job.",
};

/**
 * One shared instruction block per kind, varying only the opening sentence.
 * Deliberately never mentions `status`, `hourlyRate`, or `labourTotalOverride`
 * — see the Global Constraints note in the plan this was built from. If you
 * are adding a field to the prompt, check `extractedJobSchema` first: if it
 * is not in that schema, it must not be in this prompt either.
 */
export function buildExtractionPrompt(kind: ImportKind): string {
  const audioNote =
    kind === 'voice'
      ? ' Listen to the whole recording before answering — the transcription is an internal step, not part of your output.'
      : '';

  return `${KIND_INTRO[kind]}${audioNote}

Extract only what is explicitly stated. Do not invent or guess a value that
is not present — omit a field entirely rather than filling it with a
plausible-looking guess.

Return a single JSON object with any of these fields you can find, and
nothing else:

{
  "customerName": string,
  "customerPhone": string,
  "customerEmail": string,
  "customerAddress": string,
  "vehicleRegistration": string,
  "vehicleMake": string,
  "vehicleModel": string,
  "vehicleVin": string,
  "vehicleColor": string,
  "vehicleYear": string,
  "vehicleMileage": string,
  "dueDate": string (YYYY-MM-DD, only if an actual date is stated),
  "dueTime": string (24-hour HH:MM, only if an actual time is stated),
  "priority": string (one of: low, medium, high — only if actually implied),
  "labourLines": [{ "description": string, "hours": string }],
  "parts": [{ "partName": string, "partNumber": string, "qty": string, "unitPrice": string }],
  "otherComments": string,
  "notes": string
}

Return ONLY the JSON object. No markdown fences, no commentary, no explanation.`;
}

type MessagePayload = { text: string } | { base64: string; mimeType: string };

function isTextPayload(payload: MessagePayload): payload is { text: string } {
  return 'text' in payload;
}

/**
 * Assembles the OpenRouter `messages` array for one import kind. Markdown is
 * a plain string; screenshot/voice attach a content block alongside the same
 * prompt text — the only thing that differs between the three kinds.
 */
export function buildMessages(kind: ImportKind, payload: MessagePayload): unknown[] {
  const prompt = buildExtractionPrompt(kind);

  if (kind === 'markdown') {
    if (!isTextPayload(payload)) {
      throw new Error('buildMessages: markdown import requires a text payload.');
    }
    return [{ role: 'user', content: `${prompt}\n\n---\n${payload.text}` }];
  }

  if (isTextPayload(payload)) {
    throw new Error(`buildMessages: ${kind} import requires a base64/mimeType payload.`);
  }

  if (kind === 'screenshot') {
    return [
      {
        role: 'user',
        content: [
          { type: 'text', text: prompt },
          { type: 'image_url', image_url: { url: `data:${payload.mimeType};base64,${payload.base64}` } },
        ],
      },
    ];
  }

  // kind === 'voice'
  return [
    {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        {
          type: 'input_audio',
          input_audio: { data: payload.base64, format: mapMimeToOpenRouterFormat(payload.mimeType) },
        },
      ],
    },
  ];
}

const AUDIO_FORMAT_BY_MIME: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/aiff': 'aiff',
};

/**
 * OpenRouter's audio input accepts a fixed set of formats
 * (wav/mp3/aiff/aac/ogg/flac/m4a/pcm16/pcm24) — notably NOT `webm`, which is
 * Chrome's `MediaRecorder` default. Throws on anything unmapped rather than
 * guessing, since sending the wrong format silently fails the OpenRouter call.
 */
export function mapMimeToOpenRouterFormat(mimeType: string): string {
  const base = mimeType.split(';')[0]!.trim().toLowerCase();
  const format = AUDIO_FORMAT_BY_MIME[base];
  if (!format) {
    throw new Error(`Unsupported audio format "${mimeType}" — no OpenRouter-accepted mapping.`);
  }
  return format;
}
