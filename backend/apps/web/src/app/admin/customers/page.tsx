"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Customer {
  id: string; name: string; phone: string | null; email: string | null;
  visitCount: number; totalSpent: number; segments: string[];
}

const SEGMENTS = ["", "REPEAT", "LAPSED", "AT_RISK", "VIP", "NEW", "MEMBER"];

export default function Customers() {
  const router = useRouter();
  const [rows, setRows] = useState<Customer[]>([]);
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const params = new URLSearchParams();
      if (q) params.set("q", q);
      if (segment) params.set("segment", segment);
      setRows(await api<Customer[]>(`/customers?${params.toString()}`));
    } catch (e) {
      if ((e as ApiError).status === 401) router.push("/admin/login");
      else setError("Could not load customers.");
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [segment]);

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Customers</h1>
      <div className="row" style={{ marginBottom: 16 }}>
        <input placeholder="Search name / phone / email" value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load()} style={{ maxWidth: 320 }} />
        <select value={segment} onChange={(e) => setSegment(e.target.value)} style={{ maxWidth: 200 }}>
          {SEGMENTS.map((s) => <option key={s} value={s}>{s || "All segments"}</option>)}
        </select>
        <button className="btn secondary" onClick={load}>Search</button>
      </div>
      {error && <p className="err">{error}</p>}
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead>
            <tr><th>Name</th><th>Phone</th><th>Visits</th><th>Spent</th><th>Segments</th></tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td className="muted">{c.phone ?? "—"}</td>
                <td>{c.visitCount}</td>
                <td>{money(c.totalSpent)}</td>
                <td>{c.segments.map((s) => <span key={s} className="tag">{s}</span>)}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No customers found.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
