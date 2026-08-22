import type { Metadata } from 'next';
import './globals.css';

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cutz-bangs.sidharthkumar2028.chatgpt.site';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Cutz & Bangs Unisex Salon | Sector 15 Dwarka, New Delhi',
    template: '%s | Cutz & Bangs Dwarka',
  },
  description: 'Book haircuts, hair colour, grooming, manicure, pedicure and beauty services at Cutz & Bangs Unisex Salon on Main Kakrola Road, Sector 15 Dwarka, New Delhi.',
  keywords: ['unisex salon in Dwarka', 'salon in Sector 15 Dwarka', 'hair salon Dwarka', 'beauty salon Dwarka Delhi', 'haircut near Kakrola Road', 'Cutz and Bangs Dwarka'],
  alternates: { canonical: '/' },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1 } },
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
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
