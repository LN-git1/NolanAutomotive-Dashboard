import { recordError } from '@/lib/errors/log';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  // Browser-reported errors (the error boundary) also go into the digest log,
  // whether or not the webhook is configured.
  try {
    const reported = (await req.clone().json().catch(() => ({}))) as { title?: string; body?: string };
    await recordError({
      source: 'ui',
      label: String(reported.title ?? 'Client error'),
      message: String(reported.body ?? 'No context provided.'),
    });
  } catch {
    // Best-effort.
  }

  const url = process.env.MATRIX_DASH_WEBHOOK_URL;
  const token = process.env.MATRIX_DASH_WEBHOOK_TOKEN;

  if (!url || !token || url.includes('REPLACE_WITH_REAL') || token === 'SET_TOKEN_FROM_MATRIX_DASH_API_TOKENS') {
    return Response.json({ skipped: 'token not configured' }, { status: 200 });
  }

  const webUrl = url.replace('REPLACE_WITH_REAL_TOKEN', token);
  try {
    const body = await req.json().catch(() => ({}));
    await fetch(webUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        action: 'notify',
        title: body.title || 'Error — nolan-automotive/dashboard',
        body: body.body || 'No context provided.',
        kind: body.kind || 'error',
      }),
    });
    return Response.json({ sent: true });
  } catch (e) {
    return Response.json({ sent: false, error: String(e).slice(0, 200) }, { status: 500 });
  }
}
