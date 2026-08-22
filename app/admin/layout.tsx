import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Secure team access",
  description: "Authorised Cutz & Bangs salon operations access.",
  robots: { index: false, follow: false, nocache: true },
};

export default function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
