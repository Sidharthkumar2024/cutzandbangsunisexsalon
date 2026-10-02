import type { Metadata } from "next";
import PublicPageShell from "../components/PublicPageShell";

export const metadata: Metadata = { title: "Terms of service", description: "Terms for bookings, payments, memberships and use of the Cutz & Bangs website and customer portal.", alternates: { canonical: "/terms" } };

export default function TermsPage() {
  return <PublicPageShell>
    <header className="information-hero compact"><p className="eyebrow">Last updated · 2 October 2026</p><h1>Terms of service</h1><p>These terms apply when you use our website, book an appointment, buy a salon service, membership or package, or access the customer portal.</p></header>
    <article className="legal-copy">
      <section><h2>Bookings and arrival</h2><p>A booking request is confirmed only after the confirmation screen or salon confirmation. Please provide accurate contact details and arrive on time. Service duration and availability are estimates and may change after consultation.</p></section>
      <section><h2>Prices, changes and payment</h2><p>Displayed prices are in Indian rupees and may vary by service length, product use, hair condition or selected specialist. Any material change should be discussed before service. Payment is due when billed through the payment methods accepted at the salon.</p></section>
      <section><h2>Cancellations and refunds</h2><p>Please contact the salon as early as possible to reschedule or cancel. Refund, correction and redo requests are reviewed against the service delivered, payment record and applicable consumer law. Packages, memberships, promotional credits and rewards may have their own displayed validity and redemption conditions.</p></section>
      <section><h2>Customer portal and account security</h2><p>You are responsible for access to your mobile number and one-time codes. Do not share a login code. Tell us promptly if you believe your account or invoice information has been accessed without permission.</p></section>
      <section><h2>Marketing and reviews</h2><p>Promotional messages require the applicable consent and include available opt-out controls. Reviews should reflect a genuine experience. Offers cannot be combined unless their terms explicitly allow it.</p></section>
      <section><h2>Website and AI drafts</h2><p>Website information is provided in good faith but may change. AI-assisted answers and drafts are convenience features; final availability, price, diagnosis and service suitability must be confirmed by salon staff.</p></section>
      <section><h2>Contact and changes</h2><p>Questions can be sent through our <a href="/contact">Contact page</a>. We may update these terms when services or legal requirements change; the latest revision date appears above.</p></section>
    </article>
  </PublicPageShell>;
}
