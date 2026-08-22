export type FeaturedService = {
  id: string;
  name: string;
  category: string;
  description: string;
  priceInr: number;
  durationMinutes: number;
  displayOrder: number;
  isActive: boolean;
};

export type Testimonial = {
  id: string;
  quote: string;
  customerName: string;
  customerDetail: string;
  rating: number;
  displayOrder: number;
  isActive: boolean;
};

export type MembershipPlan = {
  id: string;
  name: string;
  tagline: string;
  payAmount: number;
  creditAmount: number;
  validityMonths: number | null;
  description: string;
  perks: string[];
  theme: 'cream' | 'wine' | 'sage';
  displayOrder: number;
  isFeatured: boolean;
  isActive: boolean;
};

export type SiteContent = {
  services: FeaturedService[];
  testimonials: Testimonial[];
  membershipPlans: MembershipPlan[];
};
