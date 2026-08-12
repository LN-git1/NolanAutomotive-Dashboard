'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';

import { Alert, Button, Card, CardBody, Field, Input } from '@/components/ui';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

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
        setError(body?.error ?? 'Sign in failed.');
        return;
      }

      // Refresh so the server re-evaluates the session before navigating.
      router.replace('/');
      router.refresh();
    } catch {
      setError('Could not reach the server. Check your connection and try again.');
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
