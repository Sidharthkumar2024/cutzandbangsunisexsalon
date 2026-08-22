"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Plan { id: string; name: string; payMinor: number; creditMinor: number; validityDays: number | null; }
interface Customer { id: string; name: string; phone: string | null; }

export default function Memberships() {
  const router = useRouter();
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [planId, setPlanId] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<Plan[]>("/membership-plans"), api<Customer[]>("/customers")])
      .then(([p, c]) => { setPlans(p); setCustomers(c); if (p[0]) setPlanId(p[0].id); })
      .catch((e: ApiError) => { if (e.status === 401) router.push("/admin/login"); });
  }, [router]);

  async function enroll() {
    setError(""); setMsg("");
    try {
      const m = await api<{ balanceMinor: number }>("/memberships", { method: "POST", body: { customerId, planId } });
      setMsg(`Enrolled — balance ${money(m.balanceMinor)}.`);
    } catch (e) {
      setError((e as ApiError).status === 401 ? "Sign in again." : "Could not enroll.");
    }
  }

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Memberships</h1>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h3>Plans</h3>
          <table>
            <thead><tr><th>Plan</th><th>Pay</th><th>Credit</th><th>Validity</th></tr></thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td>{money(p.payMinor)}</td>
                  <td style={{ fontWeight: 600 }}>{money(p.creditMinor)}</td>
                  <td className="muted">{p.validityDays ? `${p.validityDays}d` : "No expiry"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h3>Enroll a customer</h3>
          <label>Customer</label>
          <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">Select…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `(${c.phone})` : ""}</option>)}
          </select>
          <label>Plan</label>
          <select value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <button className="btn" style={{ marginTop: 16, width: "100%" }} disabled={!customerId || !planId} onClick={enroll}>
            Enroll
          </button>
          {msg && <p className="ok">{msg}</p>}
          {error && <p className="err">{error}</p>}
        </div>
      </div>
    </main>
  );
}
