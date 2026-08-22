"use client";

import { useState } from "react";
import Link from "next/link";
import { backendApi } from "../../lib/backend-api";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [message, setMessage] = useState("");

  const submit = async () => {
    setBusy(true); setMessage("");
    try {
      await backendApi.requestPasswordReset(email.trim());
      setSent(true);
    } catch (cause) {
      const value = cause instanceof Error ? cause.message : "request_failed";
      setMessage(value === "backend_not_configured" ? "The secure backend is not connected yet." : value.replaceAll("_", " "));
    } finally { setBusy(false); }
  };

  return (
    <main className="portal-auth-shell">
      <Link className="wordmark" href="/"><span>CUTZ</span><i>&</i><span>BANGS</span></Link>
      <form className="portal-auth-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
        <p className="eyebrow">Secure account recovery</p>
        <h1>{sent ? <>Check your<br /><em>email.</em></> : <>Reset your<br /><em>password.</em></>}</h1>
        <p>{sent ? "If an active account matches that address, a 30-minute reset link has been queued. The response never reveals whether an account exists." : "Enter the email used for your owner, manager, reception, staff or customer account."}</p>
        {!sent && <label>Email<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required /></label>}
        {message && <span className="portal-auth-error" role="alert">{message}</span>}
        {!sent && <button className="button admin-primary" type="submit" disabled={busy || !email}>{busy ? "Requesting…" : "Send secure reset link"}</button>}
        <Link className="auth-mode-link" href="/admin/login">Back to team login</Link>
      </form>
    </main>
  );
}
