import type { Metadata, Viewport } from 'next';
import { Lora, Outfit } from 'next/font/google';

import './globals.css';

const outfit = Outfit({
  variable: '--font-outfit',
  subsets: ['latin'],
});

const lora = Lora({
  variable: '--font-lora',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Mental Pieces',
  description:
    'Plataforma de gestión y seguimiento psicológico',
  applicationName: 'Mental Pieces',
  appleWebApp: {
    capable: true,
    title: 'Mental Pieces',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
  formatDetection: { telephone: false },
};

// PWA: theme color for the browser/OS chrome; viewport-fit=cover enables safe-area insets.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#6b8f71',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      className={`${outfit.variable} ${lora.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}