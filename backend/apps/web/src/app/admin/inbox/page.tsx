"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, ApiError } from "@/lib/api";
import AdminNav from "@/components/AdminNav";

interface Convo { id: string; unread: boolean; customer: { name: string; phone: string | null } | null; channel: { type: string }; }
interface Message { id: string; direction: string; body: string | null; createdAt: string; }
interface ConvoDetail extends Convo { messages: Message[]; }

export default function Inbox() {
  const router = useRouter();
  const [convos, setConvos] = useState<Convo[]>([]);
  const [active, setActive] = useState<ConvoDetail | null>(null);
  const [reply, setReply] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      setConvos(await api<Convo[]>("/inbox"));
    } catch (e) {
      if ((e as ApiError).status === 401) router.push("/admin/login");
    }
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function open(id: string) {
    setActive(await api<ConvoDetail>(`/inbox/${id}`));
    load();
  }

  async function send(internal: boolean) {
    if (!active || !reply.trim()) return;
    try {
      await api(`/inbox/${active.id}/messages`, { method: "POST", body: { body: reply, internal } });
      setReply("");
      open(active.id);
    } catch { setError("Could not send."); }
  }

  return (
    <main className="container" style={{ padding: "32px 20px" }}>
      <AdminNav />
      <h1>Inbox</h1>
      {error && <p className="err">{error}</p>}
      <div className="grid" style={{ gridTemplateColumns: "300px 1fr" }}>
        <div className="card" style={{ padding: 0, maxHeight: 500, overflowY: "auto" }}>
          {convos.map((c) => (
            <div key={c.id} onClick={() => open(c.id)}
              style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)", cursor: "pointer", fontWeight: c.unread ? 700 : 400 }}>
              {c.customer?.name ?? c.customer?.phone ?? "Unknown"}
              <span className="tag" style={{ marginLeft: 8 }}>{c.channel.type.replace("WHATSAPP_", "WA ")}</span>
            </div>
          ))}
          {convos.length === 0 && <p className="muted" style={{ padding: 16 }}>No conversations yet.</p>}
        </div>
        <div className="card">
          {!active && <p className="muted">Select a conversation.</p>}
          {active && (
            <>
              <h3>{active.customer?.name ?? "Conversation"}</h3>
              <div style={{ maxHeight: 340, overflowY: "auto", marginBottom: 12 }}>
                {active.messages.map((m) => (
                  <div key={m.id} style={{ textAlign: m.direction === "out" ? "right" : "left", margin: "6px 0" }}>
                    <span style={{
                      display: "inline-block", padding: "8px 12px", borderRadius: 12,
                      background: m.direction === "internal_note" ? "var(--border)" : m.direction === "out" ? "var(--accent)" : "var(--surface)",
                      color: m.direction === "out" ? "var(--accent-ink)" : "var(--text)",
                      border: "1px solid var(--border)", maxWidth: "75%",
                    }}>
                      {m.direction === "internal_note" && <em className="muted">note: </em>}{m.body}
                    </span>
                  </div>
                ))}
              </div>
              <textarea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Type a reply…" rows={2} />
              <div className="row" style={{ marginTop: 8 }}>
                <button className="btn" onClick={() => send(false)} disabled={!reply.trim()}>Send</button>
                <button className="btn secondary" onClick={() => send(true)} disabled={!reply.trim()}>Add internal note</button>
              </div>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
