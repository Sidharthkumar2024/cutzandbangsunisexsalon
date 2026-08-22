"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { backendApi } from "../../../lib/backend-api";

type Preview = Awaited<ReturnType<typeof backendApi.previewStaffInvite>>;

export default function StaffInviteForm({ token }: { token: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [message, setMessage] = useState(token ? "Checking your invitation…" : "This invitation link is incomplete.");

  useEffect(() => {
    if (!token) return;
    let active = true;
    backendApi.previewStaffInvite(token)
      .then((value) => { if (active) { setPreview(value); setMessage(""); } })
      .catch(() => { if (active) setMessage("This invitation is invalid, expired or already used."); });
    return () => { active = false; };
  }, [token]);

  const submit = async () => {
    if (password !== confirm) { setMessage("Passwords do not match."); return; }
    setBusy(true); setMessage("");
    try {
      await backendApi.acceptStaffInvite(token, password);
      setComplete(true); setPassword(""); setConfirm("");
    } catch (cause) {
      const value = cause instanceof Error ? cause.message : "invitation_failed";
      setMessage(value === "invalid_or_expired_invitation" ? "This invitation is invalid, expired or already used." : value.replaceAll("_", " "));
    } finally { setBusy(false); }
  };

  return (
    <form className="portal-auth-card" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="eyebrow">Secure team onboarding</p>
      <h1>{complete ? <>Account<br /><em>activated.</em></> : <>Join the salon<br /><em>workspace.</em></>}</h1>
      {preview && !complete && <p><strong>{preview.staff.displayName}</strong> · {preview.staff.designation}<br />{preview.role.toLowerCase()} access for {preview.email}</p>}
      {complete ? <p>Your password is set. Sign in through the correct secure portal; access is limited to the permissions selected by the owner.</p> : <p>Create your private password. It is never shown to the owner or sent by email.</p>}
      {!complete && preview && <>
        <label>New password<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label>Confirm password<input type="password" autoComplete="new-password" minLength={10} maxLength={128} value={confirm} onChange={(event) => setConfirm(event.target.value)} required /></label>
      </>}
      {message && <span className="portal-auth-error" role="alert">{message}</span>}
      {!complete && <button className="button admin-primary" type="submit" disabled={busy || !preview || password.length < 10 || !confirm}>{busy ? "Activating…" : "Activate team account"}</button>}
      {complete && <div className="portal-auth-links"><Link href="/admin/login">Manager / reception login</Link><Link href="/staff">Staff portal</Link></div>}
    </form>
  );
}
