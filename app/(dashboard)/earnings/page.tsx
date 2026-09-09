import type { Metadata } from 'next';
import Link from 'next/link';

import { EarningsPanel } from '@/components/earnings/earnings-panel';
import { SwipeNav } from '@/components/earnings/swipe-nav';
import { getBooksSummary } from '@/lib/db/queries/books';

export const metadata: Metadata = { title: 'Earnings & Expenses' };
export const dynamic = 'force-dynamic';

/**
 * Reached from the Overview page by a right-to-left swipe on mobile, and from
 * the sidebar's Earnings & Expenses entry everywhere. The "← Overview" link is
 * the way back for anyone who lands here without swiping.
 */
export default async function EarningsPage() {
  const summary = await getBooksSummary();

  return (
    <SwipeNav to="/" direction="right">
      <div className="flex flex-col gap-4">
        <div>
          <Link href="/" className="text-sm text-brand-dark hover:underline">
            ← Overview
          </Link>
          <h1 className="mt-1 text-lg font-semibold text-ink">Earnings & Expenses</h1>
          <p className="text-sm text-muted">Money in, money out, profit — month by month.</p>
        </div>

        <EarningsPanel summary={summary} />
      </div>
    </SwipeNav>
  );
}
