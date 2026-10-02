import type { Metadata } from "next";
import Link from "next/link";
import BrandLogo from "../components/BrandLogo";
import WebsiteChat from "../components/WebsiteChat";

export const metadata: Metadata = {
  title: "Contact, timings & directions",
  description: "Contact Cutz & Bangs Unisex Salon, First Floor, Plot 118, Main Kakrola Road, Sector 15 Dwarka, New Delhi. Open daily 10 AM to 8 PM.",
  alternates: { canonical: "/contact" },
};

const map = "https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3502.4358449397055!2d77.02837029999999!3d28.6166967!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x390d05f93ff5bc51%3A0xdc23c9b9f0a73dea!2sCutz%20%26%20Bangs%20Unisex%20Salon!5e0!3m2!1sen!2sin!4v1787408457453!5m2!1sen!2sin";

export default function ContactPage() {
  return <main className="site-shell contact-page">
    <nav className="topbar"><Link className="wordmark brand-image-link" href="/"><BrandLogo priority /></Link><div className="nav-links"><Link href="/#services">Services</Link><Link href="/#membership">Memberships</Link><Link href="/contact">Contact</Link></div><div className="nav-actions"><Link className="staff-login" href="/customer">Sign in</Link><Link className="button button-dark nav-book" href="/book">Book a visit</Link></div></nav>
    <section className="contact-hero"><div><p className="eyebrow">Sector 15 Dwarka · New Delhi</p><h1>Let’s plan your<br/><em>next salon visit.</em></h1><p>Questions about a cut, colour, package or appointment? Reach the salon desk or come by during opening hours.</p><div className="hero-actions"><Link className="button button-coral" href="/book">Book online</Link><a className="text-link" href="https://www.google.com/maps/search/?api=1&query=28.6166967%2C77.0283703" target="_blank" rel="noreferrer">Open directions ↗</a></div></div><aside><span>Open daily</span><strong>10:00 AM — 8:00 PM</strong><small>Appointments and walk-ins welcome</small></aside></section>
    <section className="contact-grid"><article><p className="eyebrow">Visit</p><h2>Cutz &amp; Bangs<br/>Unisex Salon</h2><address>First Floor, Plot No. 118,<br/>Main Kakrola Road, Patel Garden,<br/>Sector 15 Dwarka, New Delhi,<br/>Delhi 110059</address><div><a href="https://www.google.com/maps/search/?api=1&query=28.6166967%2C77.0283703" target="_blank" rel="noreferrer">Google Maps &amp; reviews ↗</a><a href="https://www.instagram.com/cutzandbangs/" target="_blank" rel="noreferrer">Instagram ↗</a><a href="https://www.facebook.com/profile.php?id=61582192802691" target="_blank" rel="noreferrer">Facebook ↗</a><a href="https://magicpin.in/New-Delhi/Sector-15/Beauty/Cutz-and-Bangs-Unisex-Salon/store/1a44068" target="_blank" rel="noreferrer">Magicpin ↗</a></div></article><iframe title="Cutz & Bangs salon map" src={map} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></section>
    <section className="booking-peek"><div><p className="eyebrow">Hair · colour · grooming · beauty</p><h2>Good hair starts with a conversation.</h2></div><Link className="button button-light" href="/book">Choose services <span>→</span></Link></section>
    <footer className="footer"><Link className="wordmark brand-image-link" href="/"><BrandLogo /></Link><p>Sector 15 Dwarka · New Delhi 110059</p><div><Link href="/">Home</Link><Link href="/about">About</Link><Link href="/book">Book</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/customer">My account</Link></div></footer>
    <WebsiteChat />
  </main>;
}
