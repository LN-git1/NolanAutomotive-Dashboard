import { describe, expect, it } from 'vitest';

import { isTransientDbError, withDbRetry } from '@/lib/db/retry';

function codedError(code: string, message = 'boom'): Error & { code: string } {
  return Object.assign(new Error(message), { code });
}

describe('isTransientDbError', () => {
  it('treats pooler and connection failures as transient', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', '53300', '57P01', '08006', '57014']) {
      expect(isTransientDbError(codedError(code)), code).toBe(true);
    }
  });

  it('treats the pooler back-off notice as transient', () => {
    expect(
      isTransientDbError(
        new Error('(ECIRCUITBREAKER) too many connections, new connections are temporarily blocked'),
      ),
    ).toBe(true);
  });

  it('never retries auth rejection, so a rotated password surfaces immediately', () => {
    expect(isTransientDbError(codedError('28P01', 'password authentication failed for user "postgres"'))).toBe(
      false,
    );
  });

  it('never retries a missing relation, so an unapplied migration surfaces immediately', () => {
    expect(isTransientDbError(codedError('42P01', 'relation "expenses" does not exist'))).toBe(false);
    expect(isTransientDbError(new Error('relation "expenses" does not exist'))).toBe(false);
  });
});

describe('withDbRetry', () => {
  it('returns the first-attempt result without sleeping', async () => {
    const delays: number[] = [];
    const result = await withDbRetry('test:ok', async () => 42, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    expect(result).toBe(42);
    expect(delays).toEqual([]);
  });

  it('retries transient failures and returns the eventual result', async () => {
    const delays: number[] = [];
    let calls = 0;
    const result = await withDbRetry(
      'test:flaky',
      async () => {
        calls += 1;
        if (calls < 3) throw codedError('ECONNRESET');
        return 'recovered';
      },
      {
        sleep: async (ms) => {
          delays.push(ms);
        },
      },
    );

    expect(result).toBe('recovered');
    expect(calls).toBe(3);
    expect(delays).toHaveLength(2);
  });

  it('backs off exponentially between attempts', async () => {
    const delays: number[] = [];
    await expect(
      withDbRetry(
        'test:doomed',
        async () => {
          throw codedError('53300', 'too many connections');
        },
        {
          attempts: 3,
          baseDelayMs: 100,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toMatchObject({ code: '53300' });

    expect(delays).toEqual([100, 200]);
  });

  it('does not retry fatal errors', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withDbRetry(
        'test:fatal',
        async () => {
          calls += 1;
          throw codedError('28P01', 'password authentication failed');
        },
        {
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toMatchObject({ code: '28P01' });

    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('gives up after the configured attempts and rethrows the last error', async () => {
    const delays: number[] = [];
    let calls = 0;
    await expect(
      withDbRetry(
        'test:giveup',
        async () => {
          calls += 1;
          throw codedError('ECONNRESET', `failure ${calls}`);
        },
        {
          attempts: 2,
          sleep: async (ms) => {
            delays.push(ms);
          },
        },
      ),
    ).rejects.toThrow('failure 2');

    expect(calls).toBe(2);
  });
});
