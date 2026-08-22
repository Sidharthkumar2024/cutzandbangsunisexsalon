"use client";

import { type FormEvent, useEffect, useMemo, useState } from "react";
import { backendApi, type WebsiteChatMessage } from "../../lib/backend-api";

const storageKey = "cutz_bangs_chat_thread";
const identityKey = "cutz_bangs_chat_identity";

export default function WebsiteChat() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<WebsiteChatMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const unread = useMemo(() => messages.filter((message) => message.direction === "out").length, [messages]);

  useEffect(() => {
    const existing = window.localStorage.getItem(storageKey);
    const next = existing || crypto.randomUUID();
    if (!existing) window.localStorage.setItem(storageKey, next);
    window.queueMicrotask(() => {
      setThreadId(next);
      try {
        const identity = JSON.parse(window.localStorage.getItem(identityKey) ?? "{}") as { name?: string; phone?: string };
        setName(identity.name ?? "");
        setPhone(identity.phone ?? "");
      } catch {
        window.localStorage.removeItem(identityKey);
      }
    });
  }, []);

  useEffect(() => {
    if (!open || !threadId) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const thread = await backendApi.websiteChatThread(threadId);
        if (!cancelled) setMessages(thread.messages);
      } catch (cause) {
        if (!cancelled && cause instanceof Error && cause.message !== "chat_not_found") setError("Chat could not be refreshed.");
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [open, threadId]);

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!threadId || !name.trim() || phone.replace(/\D/gu, "").length < 8 || !draft.trim()) return;
    setBusy(true);
    setError("");
    try {
      await backendApi.websiteChat({ branchId: "main", threadId, name: name.trim(), phone: phone.trim(), message: draft.trim() });
      window.localStorage.setItem(identityKey, JSON.stringify({ name: name.trim(), phone: phone.trim() }));
      setDraft("");
      const thread = await backendApi.websiteChatThread(threadId);
      setMessages(thread.messages);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`website-chat ${open ? "open" : ""}`}>
      {open && (
        <section className="website-chat-panel" aria-label="Chat with Cutz and Bangs">
          <header>
            <div><strong>Cutz &amp; Bangs</strong><small>Salon desk · replies appear here</small></div>
            <button type="button" aria-label="Close chat" onClick={() => setOpen(false)}>×</button>
          </header>
          <div className="website-chat-body" aria-live="polite">
            <p className="website-chat-welcome">Hi! Ask us about services, availability or memberships. The salon team can reply from the admin inbox.</p>
            {messages.map((message) => (
              <article className={message.direction === "out" ? "team" : "visitor"} key={message.id}>
                <p>{message.body}</p>
                <small>{new Date(message.createdAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</small>
              </article>
            ))}
          </div>
          <form onSubmit={send}>
            {!messages.length && <div className="website-chat-identity"><input aria-label="Your name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Your name" /><input aria-label="Mobile number" inputMode="tel" value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Mobile number" /></div>}
            <div className="website-chat-compose"><input aria-label="Message" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Type your message…" /><button disabled={busy || !draft.trim() || (!messages.length && (!name.trim() || phone.replace(/\D/gu, "").length < 8))}>{busy ? "…" : "Send"}</button></div>
            {error && <small className="website-chat-error">{error}</small>}
            <small className="website-chat-consent">Chat creates a salon enquiry only. WhatsApp marketing needs separate consent.</small>
          </form>
        </section>
      )}
      <button className="website-chat-trigger" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>{open ? "×" : "Chat"}</span>{!open && unread > 0 && <b>{unread}</b>}
      </button>
    </div>
  );
}
