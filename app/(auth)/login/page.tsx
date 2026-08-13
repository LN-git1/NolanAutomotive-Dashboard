import type { Metadata } from 'next';

import { LoginForm } from '@/components/auth/login-form';
import { ThemeToggle } from '@/components/layout/theme-toggle';

export const metadata: Metadata = { title: 'Sign in' };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-ink">Nolan Automotive</h1>
          <p className="mt-1 text-sm text-muted">Internal dashboard</p>
        </div>

        <LoginForm />

        <p className="mt-6 text-center text-xs text-muted">
          Authorised access only. This system holds customer personal data.
        </p>

        <div className="mt-4 flex justify-center">
          <ThemeToggle />
        </div>
      </div>
    </main>
  );
}
