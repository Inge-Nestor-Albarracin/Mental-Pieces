import type { Metadata } from 'next';
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