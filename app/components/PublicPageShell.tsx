import Link from "next/link";
import type { ReactNode } from "react";
import BrandLogo from "./BrandLogo";
import WebsiteChat from "./WebsiteChat";

export default function PublicPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="site-shell public-information-page">
      <nav className="topbar" aria-label="Main navigation">
        <Link className="wordmark brand-image-link" href="/" aria-label="Cutz and Bangs home"><BrandLogo priority /></Link>
        <Link className="mobile-login-pill" href="/customer">Login</Link>
        <div className="nav-links"><Link href="/about">About us</Link><Link href="/#services">Services</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link></div>
        <div className="nav-actions"><Link className="staff-login" href="/customer">Sign in</Link><Link className="button button-dark nav-book" href="/book">Book a visit</Link></div>
      </nav>
      {children}
      <footer className="footer public-footer">
        <Link className="wordmark brand-image-link" href="/"><BrandLogo /></Link>
        <p>Sector 15 Dwarka · New Delhi 110059</p>
        <div><Link href="/about">About</Link><Link href="/contact">Contact</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/customer">My account</Link></div>
      </footer>
      <WebsiteChat />
    </main>
  );
}
