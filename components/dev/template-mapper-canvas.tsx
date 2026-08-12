'use client';

import { Trash2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Alert, Button, Card, CardBody, CardHeader, Field, Input, Select } from '@/components/ui';
import type { FieldBox, TemplateCoords, TextAlign } from '@/lib/pdf/coords';
import {
  FIELD_KEY_LABELS,
  SIMPLE_FIELD_KEYS,
  type SimpleFieldKey,
} from '@/lib/pdf/fieldKeys';

const RENDER_SCALE = 1.6;

interface DraftBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Visual coordinate mapper.
 *
 * The page is rendered to a <canvas> with pdf.js rather than shown in an
 * <iframe>/<object> viewer: a native PDF viewer adds its own chrome and zoom,
 * so a click inside it cannot be reliably converted to a PDF coordinate. With a
 * canvas the render scale is known exactly, so the conversion is arithmetic.
 *
 * Every box must be tagged with a field key drawn from the same closed set the
 * stamping engine reads, so it is impossible to map a field the stamper does
 * not understand.
 */
export function TemplateMapperCanvas({ initialCoords }: { initialCoords: TemplateCoords }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [coords, setCoords] = useState<TemplateCoords>(initialCoords);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(true);

  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [draft, setDraft] = useState<DraftBox | null>(null);
  const [pendingKey, setPendingKey] = useState<SimpleFieldKey>('invoiceNumber');
  const [pendingStyle, setPendingStyle] = useState({
    fontSize: 9.5,
    minFontSize: 7,
    align: 'left' as TextAlign,
    color: 'black' as 'black' | 'white',
    bold: false,
  });

  const pageHeight = coords.pageSize.height;

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const pdfjs = await import('pdfjs-dist');
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.min.mjs',
          import.meta.url,
        ).toString();

        const response = await fetch('/api/dev/template-pdf');
        if (!response.ok) throw new Error('Could not load the template PDF.');

        const data = new Uint8Array(await response.arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;
        const page = await doc.getPage(1);
        const viewport = page.getViewport({ scale: RENDER_SCALE });

        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const context = canvas.getContext('2d');
        if (!context) throw new Error('Could not get a 2D canvas context.');

        await page.render({ canvas, canvasContext: context, viewport }).promise;
        if (!cancelled) setRendering(false);
      } catch (renderError) {
        if (!cancelled) {
          setError(renderError instanceof Error ? renderError.message : 'Failed to render the PDF.');
          setRendering(false);
        }
      }
    }

    void render();
    return () => {
      cancelled = true;
    };
  }, []);

  /** Screen pixels (relative to the canvas) -> PDF points, origin bottom-left. */
  const toPdfBox = useCallback(
    (box: DraftBox): Omit<FieldBox, 'fontSize' | 'minFontSize'> => ({
      x: Number((box.x / RENDER_SCALE).toFixed(1)),
      // The baseline is the BOTTOM edge of the drawn rectangle.
      y: Number((pageHeight - (box.y + box.height) / RENDER_SCALE).toFixed(1)),
      maxWidth: Number((box.width / RENDER_SCALE).toFixed(1)),
      maxHeight: Number((box.height / RENDER_SCALE).toFixed(1)),
    }),
    [pageHeight],
  );

  function relativePoint(event: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function handleMouseDown(event: React.MouseEvent) {
    const point = relativePoint(event);
    setDragStart(point);
    setDraft({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleMouseMove(event: React.MouseEvent) {
    if (!dragStart) return;
    const point = relativePoint(event);
    setDraft({
      x: Math.min(dragStart.x, point.x),
      y: Math.min(dragStart.y, point.y),
      width: Math.abs(point.x - dragStart.x),
      height: Math.abs(point.y - dragStart.y),
    });
  }

  function handleMouseUp() {
    setDragStart(null);
    if (draft && (draft.width < 4 || draft.height < 4)) setDraft(null);
  }

  function assignDraft() {
    if (!draft) return;

    const box = toPdfBox(draft);

    setCoords((current) => ({
      ...current,
      fields: {
        ...current.fields,
        [pendingKey]: {
          ...box,
          fontSize: pendingStyle.fontSize,
          minFontSize: pendingStyle.minFontSize,
          align: pendingStyle.align,
          ...(pendingStyle.color === 'white' ? { color: 'white' as const } : {}),
          ...(pendingStyle.bold ? { bold: true } : {}),
        },
      },
    }));

    setDraft(null);
    setStatus(`Mapped ${FIELD_KEY_LABELS[pendingKey]}.`);
  }

  function removeField(key: SimpleFieldKey) {
    setCoords((current) => {
      const fields = { ...current.fields };
      delete fields[key];
      return { ...current, fields };
    });
  }

  async function save() {
    setError(null);
    setStatus(null);

    const response = await fetch('/api/dev/template-coords', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(coords),
    });

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? 'Could not save.');
      return;
    }

    setStatus('Saved to lib/pdf/invoiceTemplateCoords.json. Run `pnpm invoice:preview` to check it.');
  }

  const mapped = Object.entries(coords.fields) as [SimpleFieldKey, FieldBox][];

  return (
    <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[auto_24rem]">
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        {status ? <Alert tone="ok">{status}</Alert> : null}
        {rendering ? <p className="text-sm text-muted">Rendering template…</p> : null}

        <div
          ref={containerRef}
          className="relative inline-block w-fit cursor-crosshair border border-line bg-surface select-none"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <canvas ref={canvasRef} className="block" />

          {/* Existing mappings */}
          {mapped.map(([key, box]) => (
            <div
              key={key}
              className="pointer-events-none absolute border border-brand bg-brand/10"
              style={{
                left: box.x * RENDER_SCALE,
                top: (pageHeight - box.y - (box.maxHeight ?? 12)) * RENDER_SCALE,
                width: box.maxWidth * RENDER_SCALE,
                height: (box.maxHeight ?? 12) * RENDER_SCALE,
              }}
            >
              <span className="absolute -top-4 left-0 bg-brand px-1 text-[10px] whitespace-nowrap text-white">
                {key}
              </span>
            </div>
          ))}

          {/* In-progress selection */}
          {draft ? (
            <div
              className="pointer-events-none absolute border-2 border-danger bg-danger/10"
              style={{ left: draft.x, top: draft.y, width: draft.width, height: draft.height }}
            />
          ) : null}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader
            title="Assign a field"
            description="Drag a box on the template, then tag it."
          />
          <CardBody className="flex flex-col gap-3">
            {draft ? (
              <p className="text-xs text-muted">
                Selection: x {(draft.x / RENDER_SCALE).toFixed(1)}, width{' '}
                {(draft.width / RENDER_SCALE).toFixed(1)}pt
              </p>
            ) : (
              <p className="text-xs text-muted">No selection. Drag on the template first.</p>
            )}

            <Field label="Field" htmlFor="fieldKey">
              <Select
                id="fieldKey"
                value={pendingKey}
                onChange={(event) => setPendingKey(event.target.value as SimpleFieldKey)}
              >
                {SIMPLE_FIELD_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {FIELD_KEY_LABELS[key]}
                  </option>
                ))}
              </Select>
            </Field>

            <div className="grid grid-cols-2 gap-2">
              <Field label="Font size" htmlFor="fontSize">
                <Input
                  id="fontSize"
                  type="number"
                  step="0.5"
                  value={pendingStyle.fontSize}
                  onChange={(event) =>
                    setPendingStyle((style) => ({ ...style, fontSize: Number(event.target.value) }))
                  }
                />
              </Field>

              <Field label="Min size" htmlFor="minFontSize">
                <Input
                  id="minFontSize"
                  type="number"
                  step="0.5"
                  value={pendingStyle.minFontSize}
                  onChange={(event) =>
                    setPendingStyle((style) => ({
                      ...style,
                      minFontSize: Number(event.target.value),
                    }))
                  }
                />
              </Field>

              <Field label="Align" htmlFor="align">
                <Select
                  id="align"
                  value={pendingStyle.align}
                  onChange={(event) =>
                    setPendingStyle((style) => ({
                      ...style,
                      align: event.target.value as TextAlign,
                    }))
                  }
                >
                  <option value="left">Left</option>
                  <option value="center">Centre</option>
                  <option value="right">Right</option>
                </Select>
              </Field>

              <Field label="Colour" htmlFor="color">
                <Select
                  id="color"
                  value={pendingStyle.color}
                  onChange={(event) =>
                    setPendingStyle((style) => ({
                      ...style,
                      color: event.target.value as 'black' | 'white',
                    }))
                  }
                >
                  <option value="black">Black</option>
                  <option value="white">White (dark banner only)</option>
                </Select>
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={pendingStyle.bold}
                onChange={(event) =>
                  setPendingStyle((style) => ({ ...style, bold: event.target.checked }))
                }
                className="size-4"
              />
              Bold
            </label>

            <Button onClick={assignDraft} disabled={!draft}>
              Assign to selection
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`Mapped fields (${mapped.length})`} />
          <CardBody className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {mapped.length === 0 ? (
              <p className="text-sm text-muted">Nothing mapped yet.</p>
            ) : (
              mapped.map(([key, box]) => (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 rounded border border-line px-2 py-1.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-medium text-ink">{key}</p>
                    <p className="text-[11px] text-muted tabular">
                      x{box.x} y{box.y} w{box.maxWidth}
                      {box.color === 'white' ? ' · white' : ''}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => removeField(key)}
                    aria-label={`Remove ${key}`}
                  >
                    <Trash2 aria-hidden className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </CardBody>
        </Card>

        <Button onClick={save}>Save coordinates</Button>

        <p className="text-xs text-muted">
          Row tables (services and parts) are geometry-driven and are edited directly in
          <code className="mx-1">lib/pdf/invoiceTemplateCoords.json</code>
          under <code>rowTemplates</code> — they are defined once as a start position, row height
          and per-column widths rather than as individual boxes.
        </p>
      </div>
    </div>
  );
}
