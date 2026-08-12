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
  /** Short form for the mobile tab bar, where six labels have to fit. */
  shortLabel: string;
  icon: LucideIcon;
  /** Match the path exactly rather than by prefix — only the root needs this. */
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Overview', shortLabel: 'Home', icon: LayoutDashboard, exact: true },
  { href: '/jobs', label: 'Jobs', shortLabel: 'Jobs', icon: Wrench },
  { href: '/invoicer', label: 'Invoicer', shortLabel: 'Invoice', icon: FileText },
  {
    href: '/awaiting-payments',
    label: 'Awaiting payments',
    shortLabel: 'Owed',
    icon: BanknoteArrowDown,
  },
  { href: '/suppliers', label: 'Owed to others', shortLabel: 'Suppliers', icon: Truck },
  { href: '/settings', label: 'Settings', shortLabel: 'Settings', icon: Settings },
];

function useIsActive() {
  const pathname = usePathname();
  return (item: NavItem) =>
    item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/**
 * Fixed bottom tab bar, phones only.
 *
 * The dashboard is used mostly one-handed on a phone in the workshop, so
 * navigation sits within thumb reach rather than at the top of the screen. It
 * is fixed rather than sticky so it survives the iOS URL bar collapsing, and it
 * pads for the home indicator when installed to the home screen.
 */
export function MobileNav() {
  const isActive = useIsActive();

  return (
    <nav
      aria-label="Main"
      className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface md:hidden"
    >
      <ul className="flex">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item);
          const Icon = item.icon;

          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-16 flex-col items-center justify-center gap-1 px-1 text-[10px] leading-none',
                  active ? 'font-semibold text-brand-dark' : 'text-muted',
                )}
              >
                <Icon aria-hidden className={cn('size-5', active && 'stroke-[2.5]')} />
                <span className="truncate">{item.shortLabel}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** Left rail, tablet and desktop. */
export function Sidebar() {
  const isActive = useIsActive();

  return (
    <nav
      aria-label="Main"
      className="hidden h-full flex-col gap-1 border-r border-line bg-surface p-3 md:flex"
    >
      <div className="px-2 pt-1 pb-4">
        <p className="text-sm font-semibold text-ink">Nolan Automotive</p>
        <p className="text-xs text-muted">Dashboard</p>
      </div>

      {NAV_ITEMS.map((item) => {
        const active = isActive(item);
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
