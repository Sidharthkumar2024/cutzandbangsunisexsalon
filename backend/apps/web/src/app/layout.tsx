import "./globals.css";
import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { PwaInstallPrompt } from "../components/PwaInstallPrompt";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL ?? "https://cutzandbangs.com"),
  applicationName: "Cutz & Bangs",
  title: {
    default: "Cutz & Bangs Unisex Salon",
    template: "%s | Cutz & Bangs",
  },
  description: "Book appointments, memberships and more at Cutz & Bangs.",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Cutz & Bangs",
  },
  formatDetection: {
    telephone: false,
  },
  openGraph: {
    type: "website",
    url: "/",
    siteName: "Cutz & Bangs Unisex Salon",
    title: "Cutz & Bangs Unisex Salon",
    description: "Salon POS, booking, CRM and campaigns for Cutz & Bangs.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Cutz & Bangs Unisex Salon" }],
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#6b2d2f",
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
        <footer className="container" style={{ padding: "28px 20px", borderTop: "1px solid var(--border)" }}>
          <Link href="/privacy">Privacy</Link>{" · "}<Link href="/terms">Terms</Link>{" · "}<Link href="/data-deletion">Data deletion</Link>{" · "}<Link href="/about">About</Link>{" · "}<Link href="/contact-us">Contact</Link>
        </footer>
        <PwaInstallPrompt />
      </body>
    </html>
  );
}
