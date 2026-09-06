import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline' };

/**
 * Shown by the service worker when a navigation fails with no network.
 *
 * Deliberately static and self-contained: it is precached at install time and
 * served with no server involved, so it cannot read the session, the database,
 * or anything else. It also sits outside the auth gate in `proxy.ts` — a
 * redirect to /login would need the network, which is precisely what is missing.
 *
 * No "Retry" button that calls `fetch`. `location.reload()` is what a retry
 * actually means here, and it is the one thing guaranteed to work.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <div
        aria-hidden
        className="flex size-14 items-center justify-center rounded-full border border-line bg-surface text-2xl"
      >
        ⚡
      </div>

      <div className="flex flex-col gap-1.5">
        <h1 className="text-lg font-semibold text-ink">No connection</h1>
        <p className="max-w-xs text-sm text-muted">
          Nolan Automotive needs a connection to load jobs and invoices. Your work is safe — nothing
          was lost.
        </p>
      </div>

      {/* A plain form GET to the current URL: a reload, with no JavaScript and
          no event handler, so this page stays a Server Component. */}
      <form>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center justify-center rounded-md border border-brand bg-brand px-4 py-2.5 text-sm font-medium whitespace-nowrap text-white transition-colors hover:bg-brand-hover active:scale-[0.97] active:bg-brand-hover"
        >
          Try again
        </button>
      </form>
    </main>
  );
}
