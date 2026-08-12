import type { MetadataRoute } from 'next';

/**
 * Web app manifest, served at /manifest.webmanifest.
 *
 * This is what makes the dashboard installable to a phone home screen, which is
 * the primary way it is used — the owner works from a phone in the workshop far
 * more often than from a desk.
 *
 * NOTE: this route and everything under /icons must stay OUTSIDE the auth gate
 * (see `proxy.ts`). A browser fetches the manifest and its icons before any
 * session exists, and an install prompt will silently never appear if they
 * redirect to the login page. Neither contains anything sensitive.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Nolan Automotive Dashboard',
    short_name: 'Nolan Auto',
    description: 'Jobs, invoicing and supplier tracking for Nolan Automotive.',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    // Matches the template's header blue, so the status bar blends into the app.
    theme_color: '#3f7fb3',
    background_color: '#f5f6f8',
    lang: 'en-IE',
    dir: 'ltr',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        // Inset artwork so Android's circular/squircle crop cannot clip it.
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
