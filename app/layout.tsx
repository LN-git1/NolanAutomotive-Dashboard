import type { Metadata, Viewport } from 'next';

import './globals.css';

export const metadata: Metadata = {
  title: {
    default: 'Nolan Automotive Dashboard',
    template: '%s · Nolan Automotive',
  },
  description: 'Internal job, invoicing and supplier dashboard for Nolan Automotive.',
  // This is a private internal tool; keep it out of every index.
  robots: { index: false, follow: false, nocache: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en-IE" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
