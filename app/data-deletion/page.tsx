import type { Metadata } from "next";
import Link from "next/link";
import PublicPageShell from "../components/PublicPageShell";

export const metadata: Metadata = {
  title: "Data deletion request",
  description: "Request deletion of personal information held by Cutz & Bangs.",
  alternates: { canonical: "/data-deletion" },
};

export default function DataDeletionPage() {
  return <PublicPageShell>
    <header className="information-hero compact">
      <p className="eyebrow">Cutz &amp; Bangs · Customer privacy</p>
      <h1>Request data deletion</h1>
      <p>You can ask Cutz &amp; Bangs to delete the personal information associated with your salon account.</p>
    </header>
    <article className="legal-copy">
      <section><h2>How to request deletion</h2><p>Send a request through our <Link href="/contact">Contact page</Link> with your registered name and mobile number. We will verify the request before taking action so that another person cannot delete your account.</p></section>
      <section><h2>What we delete</h2><p>Where deletion is permitted, we remove or anonymise your customer profile, contact details, loyalty activity, membership information and marketing preferences. We also disconnect active customer-portal sessions.</p></section>
      <section><h2>Records we may retain</h2><p>Some invoice, payment, tax, fraud-prevention and audit records may need to be retained for legal, accounting or dispute-resolution requirements. Those records are restricted and are not used for marketing.</p></section>
      <section><h2>Timing and confirmation</h2><p>We normally acknowledge a verified request within 7 days and complete the applicable deletion within 30 days. We will contact you if a record must be retained or if additional verification is required.</p></section>
      <section><h2>Other privacy choices</h2><p>To correct your details or stop promotional messages without deleting your account, contact the salon or use the opt-out link in the message. Read our <Link href="/privacy">Privacy policy</Link> for more information.</p></section>
    </article>
  </PublicPageShell>;
}
