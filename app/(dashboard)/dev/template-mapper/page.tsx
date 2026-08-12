import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { TemplateMapperCanvas } from '@/components/dev/template-mapper-canvas';
import { Alert } from '@/components/ui';
import rawCoords from '@/lib/pdf/invoiceTemplateCoords.json';
import type { TemplateCoords } from '@/lib/pdf/coords';

export const metadata: Metadata = { title: 'Template mapper' };
export const dynamic = 'force-dynamic';

/**
 * Development-only coordinate mapper.
 *
 * Gated on TEMPLATE_MAPPER in addition to the normal session check. It must
 * never be enabled in production: it exposes the template and writes a file
 * into the source tree, which a serverless filesystem cannot do anyway.
 */
export default function TemplateMapperPage() {
  if (process.env.TEMPLATE_MAPPER !== 'true') {
    notFound();
  }

  const coords = rawCoords as unknown as TemplateCoords;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Template mapper</h1>
        <p className="text-sm text-muted">
          Drag a box over a blank on the template, tag it with the data that belongs there, then
          save. Development only.
        </p>
      </div>

      <Alert tone="warn">
        Saving overwrites <code>lib/pdf/invoiceTemplateCoords.json</code> in the source tree.
        Commit the result like any other change, and verify it with{' '}
        <code>pnpm invoice:preview</code>.
      </Alert>

      <TemplateMapperCanvas initialCoords={coords} />
    </div>
  );
}
