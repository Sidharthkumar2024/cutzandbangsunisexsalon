import type { SiteContent } from './content-types';

export const defaultSiteContent: SiteContent = {
  services: [
    { id: 'signature-haircut', name: 'Signature haircut', category: 'Cut', description: 'Consultation, cut & finish', priceInr: 799, durationMinutes: 60, displayOrder: 0, isActive: true },
    { id: 'colour-ritual', name: 'Colour ritual', category: 'Colour', description: 'Bespoke colour & bond care', priceInr: 2499, durationMinutes: 120, displayOrder: 1, isActive: true },
    { id: 'skin-reset', name: 'Skin reset facial', category: 'Skin', description: 'Deep cleanse & hydration', priceInr: 1499, durationMinutes: 75, displayOrder: 2, isActive: true },
  ],
  // Reviews must come from real customers and are managed in the admin panel.
  // Keeping this empty prevents fictional testimonials from reaching production.
  testimonials: [],
  membershipPlans: [
    { id: 'basic', name: 'Basic', tagline: 'A little extra, every visit', payAmount: 3000, creditAmount: 5000, validityMonths: 12, description: 'Perfect for regular cuts, grooming and self-care.', perks: ['₹2,000 bonus value', 'Use across eligible services', 'Clear balance and ledger'], theme: 'cream', displayOrder: 0, isFeatured: false, isActive: true },
    { id: 'premium', name: 'Premium', tagline: 'Our most-loved membership', payAmount: 10000, creditAmount: 15000, validityMonths: 12, description: 'More freedom for colour, hair and skin rituals.', perks: ['₹5,000 bonus value', 'Use across eligible services', 'Priority booking windows'], theme: 'wine', displayOrder: 1, isFeatured: true, isActive: true },
    { id: 'super-premium', name: 'Super Premium', tagline: 'The complete salon year', payAmount: 20000, creditAmount: 32000, validityMonths: 12, description: 'Designed for clients who make salon care a ritual.', perks: ['₹12,000 bonus value', 'Use across eligible services', 'Complimentary consultations'], theme: 'sage', displayOrder: 2, isFeatured: false, isActive: true },
  ],
};
