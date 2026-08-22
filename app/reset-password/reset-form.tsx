"use client";

import { useState } from "react";
import Link from "next/link";
import { backendApi } from "../../lib/backend-api";

export default function ResetPasswordForm({ token }: { token: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState(token ? "" : "This reset link is incomplete.");

  const submit = async () => {
    if (password !== confirm) { setMessage("Passwords do not match."); return; }
    setBusy(true); setMessage("");
    try {
      await backendApi.resetPassword(token, password);
      setComplete(true); setPassword(""); setConfirm("");
    } catch (cause) {
      const value = cause instanceof Error ? cause.message : "reset_failed";
      setMessage(value === "invalid_or_expired_reset_token" ? "This link is invalid, expired or already used. Request a new one." : value.replaceAll("_", " "));
    } finally { setBusy(false); }
  };

  return (
    <form className="portal-auth-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="eyebrow">Secure account recovery</p>
      <h1>{complete ? <>Password<br /><em>updated.</em></> : <>Choose a new<br /><em>password.</em></>}</h1>
      <p>{complete ? "All existing sessions were revoked. Sign in again with your new password and authenticator code if 2FA is enabled." : "Use at least 10 characters. The reset link works once and expires after 30 minutes."}</p>
      {!complete && <><label>New password<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label></>}
      {message && <span className="portal-auth-error" role="alert">{message}</span>}
      {!complete && <button className="button admin-primary" type="submit" disabled={busy || !token || password.length < 10 || !confirm}>{busy ? "Updating…" : "Set new password"}</button>}
      <Link className="auth-mode-link" href={complete ? "/admin/login" : "/forgot-password"}>{complete ? "Continue to secure login" : "Request a new link"}</Link>
    </form>
  );
}
