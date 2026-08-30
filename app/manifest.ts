import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Cutz & Bangs Unisex Salon',
    short_name: 'Cutz & Bangs',
    description: 'Salon POS, booking, CRM, invoice and WhatsApp campaigns.',
    start_url: '/admin/login?source=pwa',
    scope: '/',
    display: 'standalone',
    display_override: ['window-controls-overlay', 'standalone', 'browser'],
    orientation: 'portrait-primary',
    background_color: '#f6f0e8',
    theme_color: '#5b292b',
    categories: ['business', 'productivity'],
    lang: 'en-IN',
    icons: [
      {
        src: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
    shortcuts: [
      {
        name: 'Point of sale',
        short_name: 'POS',
        description: 'Open salon billing',
        url: '/admin/pos',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Customers',
        short_name: 'Customers',
        description: 'Open salon customer list',
        url: '/admin/customers',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Campaigns',
        short_name: 'Campaigns',
        description: 'Open WhatsApp campaigns',
        url: '/admin/campaigns',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
    ],
  };
}
