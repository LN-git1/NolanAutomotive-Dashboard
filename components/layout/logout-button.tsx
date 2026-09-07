'use client';

import { LogOut } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui';

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleLogout() {
    setPending(true);
    await fetch('/api/auth/logout', { method: 'POST' });

    // Drop the service worker's caches on the way out. Nothing customer-facing
    // is cached in the first place (see public/sw.js), but this makes the
    // guarantee simple: after signing out, nothing from this session is left on
    // the device. Best-effort — never block the sign-out on it.
    void navigator.serviceWorker
      ?.getRegistration()
      .then((registration) => registration?.active?.postMessage('nolan-clear-caches'))
      .catch(() => undefined);

    router.replace('/login');
    router.refresh();
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleLogout}
      disabled={pending}
      aria-label="Sign out"
      title="Sign out"
    >
      <LogOut aria-hidden className="size-4" />
      {/* Label is dropped on the narrowest screens so the header stays one
          line — the icon plus aria-label carries the meaning. */}
      <span className="sr-only sm:not-sr-only">
        {pending ? 'Signing out…' : 'Sign out'}
      </span>
    </Button>
  );
}
