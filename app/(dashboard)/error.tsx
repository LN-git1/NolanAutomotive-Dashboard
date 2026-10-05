'use client';

import { AlertTriangle, Phone, RotateCw } from 'lucide-react';
import { useEffect } from 'react';

import { Button, Card, CardBody } from '@/components/ui';

/**
 * Next.js error boundary for everything under `(dashboard)/` — renders
 * *inside* `DashboardShell`, so the sidebar and chrome stay visible; only
 * the broken page's own content is replaced. There is no error boundary
 * anywhere else in this app (confirmed before building this one).
 *
 * Deliberately does not try to detect "is this specifically a database
 * connectivity error" versus some other bug — a genuine network failure and
 * an unrelated exception look different at the code level, but the safety
 * advice to the owner is identical either way: don't trust this page, don't
 * save/edit/delete anything, try again or call. One unified message avoids
 * a fragile error-type check for no real benefit. The health-check email
 * alert (`lib/email/resend.ts`) is the one place that CAN be specific,
 * because it only ever fires from a route that does nothing but test DB
 * connectivity.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
    // Notify via server-side webhook endpoint (token stays server-side,
    // never exposed to browser).
    try {
      fetch('/api/notify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          title: `Server error — nolan-automotive/dashboard (digest: ${error.digest || 'none'})`,
          body: `Source: nolan-automotive/dashboard. ` +
            `Category: error. ` +
            `Message: ${error.message || 'Unknown server component failure'}. ` +
            `Location: app/(dashboard)/error.tsx (React #441 — server render error; ` +
            `check Vercel Runtime Logs for underlying cause). ` +
            `Digest: ${error.digest || 'none'}. ` +
            `Timestamp: ${new Date().toISOString()}. ` +
            `Next step: grep [db] in Vercel Logs; if DB is live, inspect the digest rotation pattern.`,
          kind: 'error',
        }),
      }).catch(() => {
        // Non-blocking — notification must not prevent the error screen.
      });
    } catch {
      // Silent fallthrough; the error screen is the primary signal.
    }
  }, [error]);

  return (
    <div className="flex min-h-[60vh] items-center justify-center p-4">
      <Card className="max-w-md border-danger/40">
        <CardBody className="flex flex-col items-center gap-3 text-center">
          <AlertTriangle aria-hidden className="size-8 text-danger" />

          <div>
            <h1 className="text-base font-semibold text-ink">Can&apos;t reach your data right now</h1>
            <p className="mt-1.5 text-sm text-muted">
              This usually clears up on its own — try again in a moment.
            </p>
          </div>

          <p className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger">
            Don&apos;t add, edit, or delete anything until this is sorted.
          </p>

          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>
              <RotateCw aria-hidden className="size-4" />
              Try again
            </Button>
            <a
              href="tel:+353832013732"
              className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas sm:h-9"
            >
              <Phone aria-hidden className="size-4" />
              Still stuck? Call Support — 083 201 3732
            </a>
          </div>

          {error.digest ? <p className="text-xs text-muted">Reference: {error.digest}</p> : null}
        </CardBody>
      </Card>
    </div>
  );
}
