"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import BrandLogo from "../../components/BrandLogo";
import { useRouter } from "next/navigation";
import { backendApi } from "../../../lib/backend-api";
import { SESSION_MARKER } from "../../../lib/use-backend-integration";

const ADMIN_ROLES = new Set(["OWNER", "ADMIN", "MANAGER", "RECEPTION"]);
const CURRENT_OWNER_EMAIL = "admin@cutzandbangs.in";
const LEGACY_ADMIN_EMAILS = new Set(["owner@cutzbangs.local", "admin@cutzbangs.local"]);

function readableError(value: string) {
  const messages: Record<string, string> = {
    invalid_credentials: "Email or password is incorrect.",
    invalid_two_factor_code: "That authenticator or recovery code is not valid.",
    backend_not_configured: "The secure backend is not connected to this website yet.",
    backend_unavailable: "The secure backend is temporarily unavailable.",
    role_not_allowed: "Use the customer or staff portal for this account.",
  };
  return messages[value] ?? value.replaceAll("_", " ");
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [twoFactorRequired, setTwoFactorRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    backendApi.me(SESSION_MARKER)
      .then((user) => {
        if (!cancelled && ADMIN_ROLES.has(user.role)) router.replace("/admin");
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [router]);

  const signIn = async () => {
    setBusy(true);
    setMessage("");
    const normalizedEmail = email.trim().toLowerCase();
    if (LEGACY_ADMIN_EMAILS.has(normalizedEmail)) {
      setEmail("");
      setPassword("");
      setMessage(`The old demo login was removed. Enter ${CURRENT_OWNER_EMAIL} and the current owner password.`);
      setBusy(false);
      return;
    }
    try {
      const loginOnce = () => backendApi.login(
        normalizedEmail,
        password,
        twoFactorRequired
          ? recoveryMode
            ? { recoveryCode: code.trim() }
            : { code: code.replace(/\D/gu, "") }
          : undefined,
      );
      let result;
      try {
        result = await loginOnce();
      } catch (cause) {
        if (!(cause instanceof Error) || cause.message !== "backend_unavailable") throw cause;
        await new Promise((resolve) => window.setTimeout(resolve, 750));
        await backendApi.health();
        result = await loginOnce();
      }
      if ("twoFactorRequired" in result && result.twoFactorRequired) {
        setTwoFactorRequired(true);
        setCode("");
        return;
      }
      if (!ADMIN_ROLES.has(result.user.role)) {
        await backendApi.logout(result.token).catch(() => undefined);
        throw new Error("role_not_allowed");
      }
      setPassword("");
      router.replace("/admin");
      router.refresh();
    } catch (cause) {
      setMessage(readableError(cause instanceof Error ? cause.message : "sign_in_failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="portal-auth-shell admin-login-shell">
      <Link className="wordmark" href="/" aria-label="Back to Cutz and Bangs home">
        <BrandLogo priority />
      </Link>
      <form
        className="portal-auth-card admin-login-card"
        onSubmit={(event) => { event.preventDefault(); void signIn(); }}
      >
        <div className="secure-login-heading">
          <span aria-hidden="true">⌾</span>
          <div><p className="eyebrow">Authorised team only</p><small>Encrypted, audited salon access</small></div>
        </div>
        <h1>{twoFactorRequired ? <>Verify your<br /><em>authenticator.</em></> : <>Salon command,<br /><em>securely opened.</em></>}</h1>
        <p>
          {twoFactorRequired
            ? "Enter the current six-digit code from Google Authenticator, Microsoft Authenticator or any compatible TOTP app."
            : "Owner, admin, manager and reception accounts sign in here. Customer and staff access stays separate."}
        </p>
        {!twoFactorRequired ? (
          <>
            <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} placeholder={CURRENT_OWNER_EMAIL} required /></label>
            <label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" required /></label>
            <Link className="auth-mode-link auth-link-left" href="/forgot-password">Forgot password?</Link>
          </>
        ) : (
          <>
            <label>
              {recoveryMode ? "One-time recovery code" : "6-digit authenticator code"}
              <input
                autoFocus
                inputMode={recoveryMode ? "text" : "numeric"}
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(recoveryMode ? event.target.value.toUpperCase() : event.target.value.replace(/\D/gu, "").slice(0, 6))}
                placeholder={recoveryMode ? "XXXX-XXXX-XXXX-XXXX" : "000000"}
                required
              />
            </label>
            <button type="button" className="auth-mode-link" onClick={() => { setRecoveryMode((current) => !current); setCode(""); }}>
              {recoveryMode ? "Use authenticator code" : "Use a recovery code"}
            </button>
          </>
        )}
        {message && <span className="portal-auth-error" role="alert">{message}</span>}
        <button className="button admin-primary" type="submit" disabled={checking || busy || !email || !password || (twoFactorRequired && !code)}>
          {checking ? "Checking secure session…" : busy ? "Verifying…" : twoFactorRequired ? "Verify & open admin" : "Secure sign in"}
        </button>
        {twoFactorRequired && <button type="button" className="auth-mode-link" onClick={() => { setTwoFactorRequired(false); setCode(""); setPassword(""); }}>Use another account</button>}
        <div className="secure-login-note">
          <Image src="/logo-badge.png" alt="" width={34} height={34} onError={(event) => { event.currentTarget.style.display = "none"; }} />
          <span><strong>Session protected</strong><small>The browser receives an HttpOnly session cookie; the login token is never exposed to page scripts.</small></span>
        </div>
        <div className="portal-auth-links"><Link href="/staff">Staff portal</Link><Link href="/customer">Customer portal</Link><Link href="/">Public website</Link></div>
      </form>
    </main>
  );
}
