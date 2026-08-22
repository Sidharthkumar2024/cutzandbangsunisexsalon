"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Item { service: { name: string }; staff: { displayName: string }; startAt: string; endAt: string; }
interface Appt {
  id: string; status: string; startAt: string; isWalkIn: boolean;
  customer: { name: string } | null; guestName: string | null; items: Item[];
}

const STATUSES = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_SERVICE", "COMPLETED", "CANCELLED", "NO_SHOW"];
const BRANCH_ID = process.env.NEXT_PUBLIC_BRANCH_ID ?? "main";

export default function Calendar() {
  const router = useRouter();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Appt[]>([]);
  const [error, setError] = useState("");

  const load = useCallback(async (d: string) => {
    try {
      const from = `${d}T00:00:00.000Z`;
      const to = `${d}T23:59:59.999Z`;
      setRows(await api<Appt[]>(`/appointments?branchId=${BRANCH_ID}&from=${from}&to=${to}`));
    } catch (e) {
      if ((e as ApiError).status === 401) router.push("/admin/login");
      else setError("Could not load appointments.");
    }
  }, [router]);

  useEffect(() => { load(date); }, [date, load]);

  async function setStatus(id: string, status: string) {
    try {
      await api(`/appointments/${id}/status`, { method: "PATCH", body: { status } });
      load(date);
    } catch { setError("Could not update status."); }
  }

  const time = (s: string) => new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h1>Calendar</h1>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 200 }} />
      </div>
      {error && <p className="err">{error}</p>}
      <div className="card" style={{ padding: 0, marginTop: 12 }}>
        <table>
          <thead>
            <tr><th>Time</th><th>Customer</th><th>Service · Staff</th><th>Status</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((a) => (
              <tr key={a.id}>
                <td>{time(a.startAt)}{a.isWalkIn && <span className="tag" style={{ marginLeft: 6 }}>walk-in</span>}</td>
                <td>{a.customer?.name ?? a.guestName ?? "—"}</td>
                <td className="muted">{a.items.map((i) => `${i.service.name} · ${i.staff.displayName}`).join(", ")}</td>
                <td><span className="tag">{a.status}</span></td>
                <td style={{ textAlign: "right" }}>
                  <select value={a.status} onChange={(e) => setStatus(a.id, e.target.value)} style={{ maxWidth: 150 }}>
                    {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No appointments on this day.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
