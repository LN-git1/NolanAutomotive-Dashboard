import { DashboardShell } from '@/components/layout/dashboard-shell';
import { TimeFormatProvider } from '@/components/providers/time-format-provider';
import { requireSession } from '@/lib/auth/require-session';
import { getSettings } from '@/lib/db/queries/settings';

/**
 * Every authenticated page hangs off this layout.
 *
 * `requireSession()` here is deliberate duplication: `proxy.ts` already gates
 * these routes, but if its matcher is ever edited incorrectly this second check
 * keeps customer data from being served to an anonymous request.
 *
 * The visual chrome lives in `DashboardShell`, which has to be a client
 * component so the layout can respond to the sidebar collapsing. Pages are
 * still rendered on the server and passed through as children.
 *
 * The settings read is deliberately NOT awaited here. It used to be, which
 * meant no skeleton could stream on a hard load until the database answered —
 * `loading.tsx` only covers what the layout does not block. The promise is
 * handed to `TimeFormatProvider` instead, which syncs it into context inside
 * its own Suspense boundary once it lands; the shell, the loading skeletons
 * and every page stream immediately. Pages that need the setting still read it
 * themselves via the per-request-cached `getSettings()`, so server-rendered
 * output is exact from the first byte — only client-side consumers briefly see
 * the default.
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  await requireSession();
  const formatPromise = getSettings().then((settings) => settings.timeFormat);

  return (
    <TimeFormatProvider initialFormat="12h" formatPromise={formatPromise}>
      <DashboardShell>{children}</DashboardShell>
    </TimeFormatProvider>
  );
}
