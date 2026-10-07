/**
 * API routes answer an expired session with a bare 401 (server actions redirect
 * on their own). Without this, the owner sees a generic "could not..." error
 * and keeps retrying; send the browser to the login page instead.
 */
export function redirectIfUnauthorized(response: Response): void {
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/login');
  }
}
