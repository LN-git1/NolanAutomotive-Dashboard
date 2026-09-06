'use client';

import { useEffect } from 'react';

/**
 * Registers the service worker in `public/sw.js`.
 *
 * Production only. In development every route is recompiled on demand and the
 * asset URLs change constantly, so a cache-first worker serves stale chunks and
 * breaks Fast Refresh in ways that look like application bugs.
 *
 * Registration is deliberately late and failure is deliberately silent: the
 * worker is an optimisation (a faster launch and a nicer offline screen), and
 * nothing in the app depends on it. Browsers with no support, private modes
 * that block it, and non-HTTPS origins all simply carry on without it.
 */
export function ServiceWorker() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    // After load, so registration never competes with the first paint it exists
    // to speed up.
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // A failed registration is not worth surfacing to the owner.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }

    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
