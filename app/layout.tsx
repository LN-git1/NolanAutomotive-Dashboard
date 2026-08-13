import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Nolan Automotive Dashboard',
    template: '%s · Nolan Automotive',
  },
  description: 'Internal job, invoicing and supplier dashboard for Nolan Automotive.',
  applicationName: 'Nolan Auto',
  // This is a private internal tool; keep it out of every index.
  robots: { index: false, follow: false, nocache: true },
  manifest: '/manifest.webmanifest',

  /**
   * iOS does not use the manifest for home-screen installs the way Android
   * does — it reads these meta tags. Without `appleWebApp.capable` the app
   * opens in a Safari tab with browser chrome instead of as a standalone app.
   */
  appleWebApp: {
    capable: true,
    title: 'Nolan Auto',
    // The status bar sits over the page, so the header must respect the safe
    // area inset (handled in globals.css).
    statusBarStyle: 'black-translucent',
  },

  icons: {
    icon: [
      { url: '/favicon-32.png', sizes: '32x32', type: 'image/png' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },

  formatDetection: {
    // Stop iOS turning registrations, mileages and job numbers into phone links.
    telephone: false,
  },

  other: {
    /**
     * Next emits the standardised `mobile-web-app-capable`, which only Safari
     * 15.4+ understands. The Apple-prefixed original is added explicitly so an
     * older iPhone still launches standalone from the home screen rather than
     * inside a Safari tab. Harmless duplication on modern iOS.
     */
    'apple-mobile-web-app-capable': 'yes',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Lets the layout extend under the notch and home indicator; the safe-area
  // padding in globals.css then keeps content clear of both.
  viewportFit: 'cover',
  themeColor: '#3f7fb3',
};

/**
 * Applies the saved theme before the browser paints anything.
 *
 * This has to be a blocking inline script in <head>. Doing it in an effect, or
 * anywhere in React's lifecycle, means the page renders in the default theme
 * first and then snaps — a white flash on every single load for a dark-mode
 * user. Wrapped in try/catch because localStorage throws in some private
 * browsing modes, and a theme preference is not worth breaking the page over.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('nolan-theme');if(t!=='light'&&t!=='dark'){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.dataset.theme=t;var m=document.querySelector('meta[name="theme-color"]');if(m)m.setAttribute('content',t==='dark'?'#0f1319':'#3f7fb3');}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-IE" className="h-full" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
