"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Service { id: string; name: string; priceMinor: number; taxRateBps: number; }
interface Category { services: Service[]; }
interface Line { serviceId: string; description: string; qty: number; unitMinor: number; }

const BRANCH_ID = process.env.NEXT_PUBLIC_BRANCH_ID ?? "main";

export default function Pos() {
  const router = useRouter();
  const [services, setServices] = useState<Service[]>([]);
  const [lines, setLines] = useState<Line[]>([]);
  const [method, setMethod] = useState("CASH");
  const [result, setResult] = useState<{ number: string; totalMinor: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Category[]>("/services")
      .then((cats) => setServices(cats.flatMap((c) => c.services)))
      .catch((e: ApiError) => { if (e.status === 401) router.push("/admin/login"); });
  }, [router]);

  function addService(s: Service) {
    setLines((l) => [...l, { serviceId: s.id, description: s.name, qty: 1, unitMinor: s.priceMinor }]);
  }

  // Cutz & Bangs bills are tax-inclusive at the catalogue level, so POS does
  // not add a separate GST/tax amount on top of the displayed service price.
  const totals = lines.reduce(
    (acc, l) => {
      const base = l.qty * l.unitMinor;
      acc.subtotal += base; acc.total += base;
      return acc;
    },
    { subtotal: 0, total: 0 },
  );

  async function checkout() {
    setError("");
    try {
      const inv = await api<{ number: string; totalMinor: number }>("/pos/checkout", {
        method: "POST",
        body: {
          branchId: BRANCH_ID,
          lines: lines.map((l) => ({ kind: "service", serviceId: l.serviceId, description: l.description, qty: l.qty, unitMinor: l.unitMinor, taxRateBps: 0 })),
          payments: totals.total > 0 ? [{ method, amountMinor: totals.total }] : [],
        },
      });
      setResult(inv);
      setLines([]);
    } catch (e) {
      setError((e as ApiError).status === 401 ? "Please sign in again." : "Checkout failed.");
    }
  }

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Point of Sale</h1>
      {result && <p className="ok">Invoice {result.number} created — {money(result.totalMinor)}.</p>}
      {error && <p className="err">{error}</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h3>Services</h3>
          {services.map((s) => (
            <div key={s.id} className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
              <span>{s.name} · {money(s.priceMinor)}</span>
              <button className="btn secondary" onClick={() => addService(s)}>Add</button>
            </div>
          ))}
        </div>
        <div className="card">
          <h3>Bill</h3>
          {lines.length === 0 && <p className="muted">No items yet.</p>}
          {lines.map((l, i) => (
            <div key={i} className="row" style={{ justifyContent: "space-between" }}>
              <span>{l.description}</span>
              <span>{money(l.unitMinor * l.qty)}</span>
            </div>
          ))}
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "12px 0" }} />
          <div className="row" style={{ justifyContent: "space-between" }}><span className="muted">Subtotal</span><span>{money(totals.subtotal)}</span></div>
          <div className="row" style={{ justifyContent: "space-between", fontWeight: 700 }}><span>Total</span><span>{money(totals.total)}</span></div>
          <label>Payment method</label>
          <select value={method} onChange={(e) => setMethod(e.target.value)}>
            {["CASH", "UPI", "CARD"].map((m) => <option key={m}>{m}</option>)}
          </select>
          <button className="btn" style={{ marginTop: 16, width: "100%" }} disabled={lines.length === 0} onClick={checkout}>
            Complete sale
          </button>
        </div>
      </div>
    </main>
  );
}
