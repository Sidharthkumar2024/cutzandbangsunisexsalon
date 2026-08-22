"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Campaign { id: string; name: string; channel: string; segment: string | null; status: string; _count: { recipients: number }; }

const SEGMENTS = ["", "REPEAT", "LAPSED", "AT_RISK", "VIP", "NEW", "MEMBER"];
const BRANCH_ID = process.env.NEXT_PUBLIC_BRANCH_ID ?? "main";

export default function Campaigns() {
  const router = useRouter();
  const [rows, setRows] = useState<Campaign[]>([]);
  const [form, setForm] = useState({ name: "", channel: "EMAIL", segment: "LAPSED", content: "" });
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    try { setRows(await api<Campaign[]>("/campaigns")); }
    catch (e) { if ((e as ApiError).status === 401) router.push("/admin/login"); }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function draftWithAI() {
    setDrafting(true); setError("");
    try {
      const r = await api<{ content: string }>("/campaigns/draft", {
        method: "POST",
        body: { goal: `Re-engage ${form.segment.toLowerCase()} customers`, segment: form.segment },
      });
      setForm({ ...form, content: r.content });
    } catch { setError("AI draft failed (set ANTHROPIC_API_KEY for real drafts)."); }
    finally { setDrafting(false); }
  }

  async function create() {
    setError("");
    try {
      await api("/campaigns", {
        method: "POST",
        body: { name: form.name, channel: form.channel, segment: form.segment || undefined, content: form.content, branchId: BRANCH_ID },
      });
      setForm({ name: "", channel: "EMAIL", segment: "LAPSED", content: "" });
      load();
    } catch { setError("Could not create campaign."); }
  }

  async function approve(id: string) {
    try { await api(`/campaigns/${id}/approve`, { method: "POST" }); load(); }
    catch { setError("Could not approve."); }
  }

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Campaigns</h1>
      {error && <p className="err">{error}</p>}
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="card">
          <h3>New campaign</h3>
          <label>Name</label>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <div className="row">
            <div style={{ flex: 1 }}>
              <label>Channel</label>
              <select value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
                {["EMAIL", "WHATSAPP_OFFICIAL", "SMS"].map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <label>Segment</label>
              <select value={form.segment} onChange={(e) => setForm({ ...form, segment: e.target.value })}>
                {SEGMENTS.map((s) => <option key={s} value={s}>{s || "All"}</option>)}
              </select>
            </div>
          </div>
          <label>Message</label>
          <textarea rows={4} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn secondary" onClick={draftWithAI} disabled={drafting}>{drafting ? "Drafting…" : "✨ AI draft"}</button>
            <button className="btn" onClick={create} disabled={!form.name || !form.content}>Create (pending approval)</button>
          </div>
        </div>
        <div className="card" style={{ padding: 0 }}>
          <table>
            <thead><tr><th>Name</th><th>Segment</th><th>Recipients</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td className="muted">{c.segment ?? "All"}</td>
                  <td>{c._count.recipients}</td>
                  <td><span className="tag">{c.status}</span></td>
                  <td style={{ textAlign: "right" }}>
                    {c.status === "PENDING_APPROVAL" && <button className="btn secondary" onClick={() => approve(c.id)} style={{ padding: "4px 10px" }}>Approve &amp; send</button>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={5} className="muted">No campaigns yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
