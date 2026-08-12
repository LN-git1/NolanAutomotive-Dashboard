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
    router.replace('/login');
    router.refresh();
  }

  return (
    <Button variant="ghost" size="sm" onClick={handleLogout} disabled={pending}>
      <LogOut aria-hidden className="size-4" />
      {pending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
