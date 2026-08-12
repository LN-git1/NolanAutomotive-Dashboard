/**
 * Shared by the factory-reset action and its confirmation UI.
 *
 * It lives here rather than in the action because a `'use server'` module may
 * only export async functions — exporting a plain constant from one is a build
 * error.
 */
export const RESET_CONFIRMATION_PHRASE = 'RESET ALL DATA';
