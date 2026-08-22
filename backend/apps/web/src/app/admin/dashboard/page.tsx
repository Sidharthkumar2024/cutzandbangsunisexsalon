"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Today {
  appointments: number; walkIns: number; bills: number;
  salesMinor: number; avgBillMinor: number; lowStockCount: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [data, setData] = useState<Today | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Today>("/reports/today")
      .then(setData)
      .catch((e: ApiError) => {
        if (e.status === 401) router.push("/admin/login");
        else setError("Could not load dashboard.");
      });
  }, [router]);

  const tiles: [string, string][] = data
    ? [
        ["Appointments", String(data.appointments)],
        ["Walk-ins", String(data.walkIns)],
        ["Bills", String(data.bills)],
        ["Sales", money(data.salesMinor)],
        ["Avg bill", money(data.avgBillMinor)],
        ["Low stock", String(data.lowStockCount)],
      ]
    : [];

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Today</h1>
      {error && <p className="err">{error}</p>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
        {tiles.map(([label, value]) => (
          <div className="card" key={label}>
            <div className="muted">{label}</div>
            <div className="stat">{value}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
