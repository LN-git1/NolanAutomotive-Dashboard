'use client';

import {
  BanknoteArrowDown,
  FileText,
  LayoutDashboard,
  Settings,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Match the path exactly rather than by prefix — only the root needs this. */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/jobs', label: 'Jobs', icon: Wrench },
  { href: '/invoicer', label: 'Invoicer', icon: FileText },
  { href: '/awaiting-payments', label: 'Awaiting payments', icon: BanknoteArrowDown },
  { href: '/suppliers', label: 'Owed to others', icon: Truck },
  { href: '/settings', label: 'Settings', icon: Settings },
];

/**
 * Navigation is a horizontally scrolling bar on small screens and a fixed rail
 * from `md` up — the owner uses this on a phone in the workshop as often as at
 * a desk, and a hamburger menu would add a tap to every navigation.
 */
export function Sidebar() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Main"
      className="flex gap-1 overflow-x-auto border-b border-line bg-surface p-2 md:h-full md:flex-col md:overflow-visible md:border-r md:border-b-0 md:p-3"
    >
      <div className="hidden px-2 pt-1 pb-4 md:block">
        <p className="text-sm font-semibold text-ink">Nolan Automotive</p>
        <p className="text-xs text-muted">Dashboard</p>
      </div>

      {NAV_ITEMS.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap',
              active
                ? 'bg-info-soft font-medium text-brand-dark'
                : 'text-muted hover:bg-canvas hover:text-ink',
            )}
          >
            <Icon aria-hidden className="size-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
