'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui';

export const THEME_STORAGE_KEY = 'nolan-theme';

type Theme = 'light' | 'dark';

/**
 * The theme lives on `<html data-theme>`, not in React state.
 *
 * The inline script in app/layout.tsx sets it before first paint, so the DOM is
 * the source of truth and React only mirrors it. `useSyncExternalStore` is the
 * right tool for that: it renders the server snapshot during hydration and then
 * swaps to the real client value without a mismatch warning — and without the
 * setState-inside-an-effect that a naive implementation reaches for.
 */

let listeners: Array<() => void> = [];

function subscribe(onChange: () => void) {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((listener) => listener !== onChange);
  };
}

function getSnapshot(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

/** The server cannot know the browser's choice; hydration corrects this. */
function getServerSnapshot(): Theme {
  return 'light';
}

function applyTheme(next: Theme) {
  document.documentElement.dataset.theme = next;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Private browsing can refuse storage. The theme still applies for this
    // session, it simply will not be remembered.
  }

  // Keep the PWA status-bar colour in step with the page.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute('content', next === 'dark' ? '#0f1319' : '#3f7fb3');

  for (const listener of listeners) listener();
}

export function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isDark = theme === 'dark';

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => applyTheme(isDark ? 'light' : 'dark')}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      {isDark ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
      <span className="sr-only sm:not-sr-only">{isDark ? 'Light' : 'Dark'}</span>
    </Button>
  );
}
