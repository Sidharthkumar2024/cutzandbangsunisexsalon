import type { Metadata } from "next";
import Link from "next/link";
import PublicPageShell from "../components/PublicPageShell";

export const metadata: Metadata = {
  title: "About us",
  description: "Meet Cutz & Bangs Unisex Salon in Sector 15 Dwarka—consultation-led hair, colour, grooming and beauty care.",
  alternates: { canonical: "/about" },
};

export default function AboutPage() {
  return <PublicPageShell>
    <header className="information-hero"><p className="eyebrow">About Cutz &amp; Bangs</p><h1>Craft, care and<br/><em>honest advice.</em></h1><p>We are a neighbourhood unisex salon in Sector 15 Dwarka. Our work starts with listening, so every recommendation fits your hair, routine and comfort—not a one-size-fits-all trend.</p></header>
    <section className="information-grid">
      <article><span>01</span><h2>Consultation first</h2><p>We discuss the result, upkeep, time and price before a service begins. If something is not the right fit, we will say so.</p></article>
      <article><span>02</span><h2>Clear salon history</h2><p>With your permission, we keep your visits, invoices, memberships and preferences together so your next appointment is easier.</p></article>
      <article><span>03</span><h2>For everyone</h2><p>Hair, colour, grooming and beauty services are delivered in a welcoming studio for women, men and families.</p></article>
    </section>
    <section className="information-callout"><div><p className="eyebrow">Open daily · 10 AM to 8 PM</p><h2>Come by, or reserve your time.</h2><p>First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi 110059.</p></div><div><Link className="button button-coral" href="/book">Book a visit</Link><Link className="text-link" href="/contact">Directions &amp; contact ↗</Link></div></section>
  </PublicPageShell>;
}
