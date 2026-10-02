import type { Metadata } from "next";
import PublicPageShell from "../components/PublicPageShell";

export const metadata: Metadata = { title: "Privacy policy", description: "How Cutz & Bangs handles customer and salon account information.", alternates: { canonical: "/privacy" } };

export default function PrivacyPage() {
  return <PublicPageShell>
    <header className="information-hero compact"><p className="eyebrow">Last updated · 2 October 2026</p><h1>Privacy policy</h1><p>This policy explains what information we collect, why we use it and the choices available to Cutz &amp; Bangs customers and website visitors.</p></header>
    <article className="legal-copy">
      <section><h2>Information we collect</h2><p>When you book, buy a service, contact us or use the customer portal, we may collect your name, mobile number, email address, date of birth when you choose to provide it, appointment details, service history, invoices, payment method, membership and loyalty activity, consent choices and messages sent to the salon.</p></section>
      <section><h2>How we use it</h2><p>We use this information to deliver salon services, manage bookings and payments, provide invoices, operate memberships and rewards, answer enquiries, prevent fraud and improve our service. Promotional WhatsApp or email messages are sent only where the required consent or another lawful basis applies.</p></section>
      <section><h2>WhatsApp, email and service providers</h2><p>Messages may be delivered through Meta’s official WhatsApp Cloud API and configured email providers. Payment, hosting, storage and analytics providers process only the information required for their service. We do not sell customer personal information.</p></section>
      <section><h2>AI-assisted features</h2><p>We may use an approved AI provider to prepare a draft reply or marketing template from salon information. Staff review marketing content before submission or sending. We do not rely on AI to make decisions about a customer’s eligibility for essential services.</p></section>
      <section><h2>Retention and security</h2><p>We keep records for as long as needed for service, accounting, dispute and legal requirements. Access is limited by staff role, sensitive credentials are stored server-side, and reasonable technical and organisational safeguards are used. No online system can promise absolute security.</p></section>
      <section><h2>Your choices</h2><p>You may ask us to correct your details, withdraw marketing consent, request access or deletion where applicable, or stop promotional messages by using the opt-out offered in the message or contacting the salon. Some invoice and transaction records may need to be retained.</p></section>
      <section><h2>Contact</h2><p>For a privacy request, visit our <a href="/contact">Contact page</a> or speak to the salon desk at First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi 110059. We may verify your identity before completing a request.</p></section>
    </article>
  </PublicPageShell>;
}
