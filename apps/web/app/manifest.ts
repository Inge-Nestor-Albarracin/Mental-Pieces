import type { MetadataRoute } from 'next';

// Installable app shell. public/sw.js caches only static files and an offline page:
// clinical and personal data never persist on the device outside the session.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Mental Pieces',
    short_name: 'Mental Pieces',
    description: 'Plataforma de gestión y seguimiento psicológico.',
    lang: 'es-CO',
    start_url: '/login',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#f5f0eb',
    theme_color: '#6b8f71',
    categories: ['health', 'medical', 'lifestyle'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
