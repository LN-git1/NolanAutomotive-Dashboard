'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert, Button, Card, CardBody, Field, Input } from '@/components/ui';
import { useToast } from '@/components/providers/toast-provider';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        body: new FormData(event.currentTarget),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        const message = body?.error ?? 'Sign in failed.';
        setError(message);
        toast.error('Sign in failed', message);
        return;
      }

      // Refresh so the server re-evaluates the session before navigating.
      toast.success('Signed in', 'Welcome back.');
      router.replace('/');
      router.refresh();
    } catch {
      const message = 'Could not reach the server. Check your connection and try again.';
      setError(message);
      toast.error('Sign in failed', message);
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardBody>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          {error ? <Alert>{error}</Alert> : null}

          <Field label="Username" htmlFor="username" required>
            <Input
              id="username"
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              required
            />
          </Field>

          <Field label="Password" htmlFor="password" required>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </Field>

          <Button type="submit" disabled={pending}>
            {pending ? 'Signing in…' : 'Sign in'}
          </Button>
        </form>
      </CardBody>
    </Card>
  );
}
