import type { Metadata, Viewport } from 'next';
import './globals.css';
import { PwaInstallPrompt } from './components/PwaInstallPrompt';
import { SuccessNotifier } from './components/SuccessNotifier';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cutzandbangs.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: 'Cutz & Bangs',
  title: {
    default: 'Cutz & Bangs Unisex Salon | Sector 15 Dwarka, New Delhi',
    template: '%s | Cutz & Bangs Dwarka',
  },
  description: 'Book haircuts, hair colour, grooming, manicure, pedicure and beauty services at Cutz & Bangs Unisex Salon on Main Kakrola Road, Sector 15 Dwarka, New Delhi.',
  manifest: '/manifest.webmanifest',
  keywords: ['unisex salon in Dwarka', 'salon in Sector 15 Dwarka', 'hair salon Dwarka', 'beauty salon Dwarka Delhi', 'haircut near Kakrola Road', 'Cutz and Bangs Dwarka'],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Cutz & Bangs',
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: 'website',
    locale: 'en_IN',
    url: '/',
    siteName: 'Cutz & Bangs Unisex Salon',
    title: 'Cutz & Bangs Unisex Salon | Sector 15 Dwarka',
    description: 'Hair, colour, grooming and beauty care on Main Kakrola Road, Sector 15 Dwarka, New Delhi.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Cutz & Bangs Unisex Salon in Sector 15 Dwarka' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cutz & Bangs Unisex Salon | Sector 15 Dwarka',
    description: 'Hair, colour, grooming and beauty care in Dwarka, New Delhi.',
    images: ['/og.png'],
  },
  icons: {
    icon: [
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#5b292b',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <SuccessNotifier />
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
