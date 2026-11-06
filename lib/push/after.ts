import { after } from 'next/server';

/**
 * Runs a notification task once the response has gone out, and swallows any
 * failure.
 *
 * Used by server actions (create a job, record a charge...) so a notification
 * can never slow a save down or make it fail. Callers pass a function that
 * `import()`s the push code inside it, so a page that merely contains a server
 * action does not pay to load the push library until something is sent.
 *
 * `after()` throws when called outside a request (for example from a unit
 * test); in that case the task just runs inline, still guarded.
 */
export function runAfterResponse(task: () => Promise<unknown>): void {
  const guarded = async () => {
    try {
      await task();
    } catch (error) {
      console.error('[push] background task failed:', error instanceof Error ? error.message : 'unknown error');
    }
  };

  try {
    after(guarded);
  } catch {
    void guarded();
  }
}
