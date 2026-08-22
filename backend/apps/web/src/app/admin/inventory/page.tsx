"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, money, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Product {
  id: string; name: string; brand: string | null; sku: string | null;
  sellMinor: number; stockQty: number; reorderLevel: number;
}

export default function Inventory() {
  const router = useRouter();
  const [rows, setRows] = useState<Product[]>([]);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", brand: "", sellMinor: "", reorderLevel: "" });

  async function load() {
    try {
      setRows(await api<Product[]>("/products"));
    } catch (e) {
      if ((e as ApiError).status === 401) router.push("/admin/login");
      else setError("Could not load products.");
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function addProduct() {
    setError("");
    try {
      await api("/products", {
        method: "POST",
        body: {
          name: form.name,
          brand: form.brand || undefined,
          sellMinor: Math.round(Number(form.sellMinor) * 100) || 0,
          reorderLevel: Number(form.reorderLevel) || 0,
        },
      });
      setForm({ name: "", brand: "", sellMinor: "", reorderLevel: "" });
      load();
    } catch { setError("Could not add product."); }
  }

  async function adjust(id: string, qtyDelta: number) {
    try {
      await api(`/products/${id}/movement`, { method: "POST", body: { qtyDelta, reason: "ADJUSTMENT" } });
      load();
    } catch { setError("Could not adjust stock."); }
  }

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Inventory</h1>
      {error && <p className="err">{error}</p>}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row">
          <input placeholder="Product name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ maxWidth: 220 }} />
          <input placeholder="Brand" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={{ maxWidth: 160 }} />
          <input placeholder="Sell ₹" value={form.sellMinor} onChange={(e) => setForm({ ...form, sellMinor: e.target.value })} style={{ maxWidth: 100 }} />
          <input placeholder="Reorder lvl" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} style={{ maxWidth: 110 }} />
          <button className="btn" disabled={!form.name} onClick={addProduct}>Add product</button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table>
          <thead><tr><th>Product</th><th>SKU</th><th>Price</th><th>Stock</th><th>Adjust</th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>{p.name} {p.brand && <span className="muted">· {p.brand}</span>}</td>
                <td className="muted">{p.sku ?? "—"}</td>
                <td>{money(p.sellMinor)}</td>
                <td>
                  {p.stockQty}
                  {p.stockQty <= p.reorderLevel && <span className="tag" style={{ marginLeft: 6, background: "#c0392b", color: "#fff" }}>low</span>}
                </td>
                <td>
                  <button className="btn secondary" onClick={() => adjust(p.id, 1)} style={{ padding: "4px 10px" }}>+1</button>{" "}
                  <button className="btn secondary" onClick={() => adjust(p.id, -1)} style={{ padding: "4px 10px" }}>−1</button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={5} className="muted">No products yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
