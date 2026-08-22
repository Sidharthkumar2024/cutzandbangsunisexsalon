import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Cutz & Bangs Unisex Salon",
  description: "Book appointments, memberships and more at Cutz & Bangs.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">Cutz &amp; Bangs</Link>
          <div>
            <Link href="/services">Services</Link>
            <Link href="/book">Book</Link>
            <Link href="/admin/login">Admin</Link>
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
