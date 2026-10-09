import { describe, expect, it } from 'vitest';

import { MAX_TOASTS, pushToast, removeToast, toastTtl, type Toast } from '@/lib/toast';

describe('pushToast', () => {
  it('adds new toasts at the top, newest first', () => {
    const first = pushToast([], { kind: 'success', title: 'One' }, 1).list;
    const second = pushToast(first, { kind: 'error', title: 'Two' }, 2).list;

    expect(second.map((toast) => toast.title)).toEqual(['Two', 'One']);
    expect(second.map((toast) => toast.id)).toEqual([2, 1]);
  });

  it('keeps the message when one is given', () => {
    const { list } = pushToast([], { kind: 'success', title: 'Saved', message: 'Job J-0004' }, 1);
    expect(list[0]?.message).toBe('Job J-0004');
  });

  it(`caps the queue at ${MAX_TOASTS} and drops the oldest`, () => {
    let list: Toast[] = [];
    let dropped: Toast | null = null;

    for (let i = 1; i <= MAX_TOASTS + 1; i += 1) {
      const result = pushToast(list, { kind: 'info', title: `Toast ${i}` }, i);
      list = result.list;
      dropped = result.dropped;
    }

    expect(list).toHaveLength(MAX_TOASTS);
    expect(list.map((toast) => toast.id)).toEqual([5, 4, 3, 2]);
    // The first toast pushed is the one that had to go.
    expect(dropped?.id).toBe(1);
  });

  it('reports no dropped toast while under the cap', () => {
    const { dropped } = pushToast([], { kind: 'success', title: 'Only one' }, 1);
    expect(dropped).toBeNull();
  });
});

describe('removeToast', () => {
  it('removes exactly the requested toast', () => {
    const list: Toast[] = [
      { id: 2, kind: 'success', title: 'Two' },
      { id: 1, kind: 'error', title: 'One' },
    ];

    expect(removeToast(list, 1).map((toast) => toast.id)).toEqual([2]);
  });

  it('is a no-op for an unknown id', () => {
    const list: Toast[] = [{ id: 1, kind: 'info', title: 'One' }];
    expect(removeToast(list, 99)).toEqual(list);
  });
});

describe('toastTtl', () => {
  it('gives errors the longest life and successes the shortest', () => {
    expect(toastTtl('success')).toBeLessThan(toastTtl('info'));
    expect(toastTtl('info')).toBeLessThan(toastTtl('warning'));
    expect(toastTtl('warning')).toBeLessThan(toastTtl('error'));
  });
});
