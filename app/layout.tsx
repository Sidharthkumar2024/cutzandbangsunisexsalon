import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cutz-bangs.sites.openai.com'),
  title: 'Cutz & Bangs | Salon, thoughtfully done',
  description: 'Book thoughtful cuts, colour and beauty rituals at Cutz & Bangs unisex salon.',
  openGraph: {
    title: 'Cutz & Bangs | Good hair. Great energy.',
    description: 'Thoughtful cuts, colour and care—shaped around you.',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Cutz & Bangs salon' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Cutz & Bangs | Good hair. Great energy.',
    description: 'Thoughtful cuts, colour and care—shaped around you.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
