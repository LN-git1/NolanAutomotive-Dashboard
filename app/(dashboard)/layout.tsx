import { DashboardShell } from '@/components/layout/dashboard-shell';
import { requireSession } from '@/lib/auth/require-session';

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
 */
export default async function DashboardLayout({ children }: LayoutProps<'/'>) {
  await requireSession();

  return <DashboardShell>{children}</DashboardShell>;
}
