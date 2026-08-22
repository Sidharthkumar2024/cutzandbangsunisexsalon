"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { setToken } from "@/lib/api";

const LINKS: [string, string][] = [
  ["/admin/dashboard", "Dashboard"],
  ["/admin/calendar", "Calendar"],
  ["/admin/pos", "POS"],
  ["/admin/customers", "Customers"],
  ["/admin/memberships", "Memberships"],
  ["/admin/inventory", "Inventory"],
  ["/admin/inbox", "Inbox"],
  ["/admin/campaigns", "Campaigns"],
];

export default function AdminNav() {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <div className="row" style={{ marginBottom: 24, justifyContent: "space-between" }}>
      <div className="row" style={{ gap: 16 }}>
        {LINKS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            style={{ color: pathname === href ? "var(--text)" : "var(--muted)", fontWeight: pathname === href ? 700 : 500 }}
          >
            {label}
          </Link>
        ))}
      </div>
      <button className="btn secondary" onClick={() => { setToken(null); router.push("/admin/login"); }}>
        Sign out
      </button>
    </div>
  );
}
