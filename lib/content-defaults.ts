import type { SiteContent } from './content-types';

export const defaultSiteContent: SiteContent = {
  services: [
    { id: 'signature-haircut', name: 'Signature haircut', category: 'Cut', description: 'Consultation, cut & finish', priceInr: 799, durationMinutes: 60, displayOrder: 0, isActive: true },
    { id: 'colour-ritual', name: 'Colour ritual', category: 'Colour', description: 'Bespoke colour & bond care', priceInr: 2499, durationMinutes: 120, displayOrder: 1, isActive: true },
    { id: 'skin-reset', name: 'Skin reset facial', category: 'Skin', description: 'Deep cleanse & hydration', priceInr: 1499, durationMinutes: 75, displayOrder: 2, isActive: true },
  ],
  testimonials: [
    { id: 'aanya', quote: 'They remembered my colour formula and what I liked last time. The whole visit felt effortless.', customerName: 'Aanya Mehta', customerDetail: 'Colour client · 12 visits', rating: 5, displayOrder: 0, isActive: true },
    { id: 'kabir', quote: 'Arjun listened properly, explained what would suit me, and gave me the easiest haircut I have ever maintained.', customerName: 'Kabir Sethi', customerDetail: 'Grooming client · 7 visits', rating: 5, displayOrder: 1, isActive: true },
    { id: 'diya', quote: 'Warm people, calm space, no hard selling. I booked my next facial before I left.', customerName: 'Diya Rao', customerDetail: 'Skin client · New member', rating: 5, displayOrder: 2, isActive: true },
  ],
  membershipPlans: [
    { id: 'essential', name: 'Essential', tagline: 'A little extra, every visit', payAmount: 3000, creditAmount: 5000, validityMonths: 6, description: 'Perfect for regular cuts, grooming and self-care.', perks: ['₹2,000 bonus value', 'Use across eligible services', 'Clear balance and ledger'], theme: 'cream', displayOrder: 0, isFeatured: false, isActive: true },
    { id: 'prive', name: 'Privé', tagline: 'Our most-loved membership', payAmount: 10000, creditAmount: 15000, validityMonths: 12, description: 'More freedom for colour, hair and skin rituals.', perks: ['₹5,000 bonus value', '5% member service discount', 'Priority booking windows'], theme: 'wine', displayOrder: 1, isFeatured: true, isActive: true },
    { id: 'signature', name: 'Signature', tagline: 'The complete salon year', payAmount: 20000, creditAmount: 32000, validityMonths: 18, description: 'Designed for clients who make salon care a ritual.', perks: ['₹12,000 bonus value', '10% member service discount', 'Complimentary consultations'], theme: 'sage', displayOrder: 2, isFeatured: false, isActive: true },
  ],
};
