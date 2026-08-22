"use client";

import { useState } from "react";
import Link from "next/link";
import { backendApi, type CustomerPortalOverview } from "../../lib/backend-api";

const money = (minor: number) =>
  `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;

export default function CustomerPortal() {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [data, setData] = useState<CustomerPortalOverview | null>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const authenticate = async () => {
    setBusy(true);
    setMessage("");
    try {
      const session =
        mode === "login"
          ? await backendApi.login(email, password)
          : await backendApi.registerCustomer({
              name,
              email,
              phone: phone || undefined,
              password,
              branchId: "main",
            });
      if ("twoFactorRequired" in session && session.twoFactorRequired)
        throw new Error("two_factor_verification_required");
      if (session.user.role !== "CUSTOMER")
        throw new Error("customer_account_required");
      setData(await backendApi.customerOverview(session.token));
      setToken(session.token);
      setPassword("");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message.replaceAll("_", " ")
          : "Sign in failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const requestReschedule = async (appointmentId: string) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.requestCustomerReschedule(token, appointmentId);
      setMessage("Your reschedule request was sent to the salon team. They will confirm the new time with you.");
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Request could not be sent.");
    } finally {
      setBusy(false);
    }
  };
  if (!data)
    return (
      <main className="portal-auth-shell">
        <Link className="wordmark" href="/">
          <span>CUTZ</span>
          <i>&</i>
          <span>BANGS</span>
        </Link>
        <section className="portal-auth-card">
          <p className="eyebrow">Customer portal</p>
          <h1>
            Your salon history,
            <br />
            <em>kept together.</em>
          </h1>
          <p>
            Bookings, invoices and membership balance are protected by your
            account.
          </p>
          <div className="portal-auth-tabs">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
          </div>
          {mode === "register" && (
            <>
              <label>
                Name
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Your name"
                />
              </label>
              <label>
                Phone
                <input
                  value={phone}
                  onChange={(event) => setPhone(event.target.value)}
                  placeholder="+91…"
                />
              </label>
            </>
          )}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={
                mode === "register" ? "At least 8 characters" : "Your password"
              }
            />
          </label>
          {mode === "login" && <Link className="auth-mode-link" href="/forgot-password">Forgot password?</Link>}
          {message && <span className="portal-auth-error">{message}</span>}
          <button
            className="button admin-primary"
            disabled={
              busy ||
              !email ||
              !password ||
              (mode === "register" && (!name || password.length < 8))
            }
            onClick={() => void authenticate()}
          >
            {busy
              ? "Opening portal…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </section>
      </main>
    );

  const upcoming = data.appointments
    .filter(
      (item) =>
        new Date(item.startAt) > new Date() &&
        !["CANCELLED", "NO_SHOW"].includes(item.status),
    )
    .sort((a, b) => +new Date(a.startAt) - +new Date(b.startAt))[0];
  const membership = data.memberships[0];
  const servicePackages = data.servicePackages ?? [];
  return (
    <main className="portal-shell customer-portal">
      <header className="portal-header">
        <Link className="wordmark" href="/">
          <span>CUTZ</span>
          <i>&</i>
          <span>BANGS</span>
        </Link>
        <nav>
          <a className="active" href="#overview">
            Overview
          </a>
          <a href="#appointments">Appointments</a>
          <a href="#history">History</a>
          <a href="#invoices">Invoices</a>
        </nav>
        <div className="portal-profile">
          <span>
            {data.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <strong>{data.name.split(" ")[0]}</strong>
            <small>Secure account</small>
          </div>
          <button onClick={() => { if (token) void backendApi.logout(token).catch(() => undefined); setData(null); setToken(""); }}>Sign out</button>
        </div>
      </header>
      <div className="portal-content" id="overview">
        {message && <div className="calendar-message">{message}</div>}
        <section className="portal-welcome">
          <div>
            <p className="eyebrow">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <h1>
              Hey {data.name.split(" ")[0]},<br />
              <em>good hair day ahead.</em>
            </h1>
            <p>
              {upcoming
                ? "Your next appointment is confirmed in your live salon record."
                : "Ready when you are—your next appointment is only a few taps away."}
            </p>
          </div>
          <div className="portal-orbit">
            <span>
              {data.name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2)}
            </span>
            <i className="orbit-one">✦</i>
            <i className="orbit-two">✦</i>
          </div>
        </section>
        <div className="portal-grid">
          {upcoming ? (
            <article className="upcoming-card" id="appointments">
              <div className="upcoming-date">
                <span>{new Date(upcoming.startAt).getDate()}</span>
                <small>
                  {new Date(upcoming.startAt)
                    .toLocaleDateString("en-IN", {
                      month: "short",
                      weekday: "short",
                    })
                    .toUpperCase()}
                </small>
              </div>
              <div>
                <p className="eyebrow">Up next</p>
                <h2>
                  {upcoming.items.map((item) => item.service.name).join(" + ")}
                </h2>
                <p>
                  {new Date(upcoming.startAt).toLocaleString("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}{" "}
                  · with{" "}
                  {upcoming.items
                    .map((item) => item.staff.displayName)
                    .join(", ")}
                </p>
                <div>
                  <a className="portal-inline-button" href="https://www.google.com/maps/search/?api=1&query=28.6166967%2C77.0283703" target="_blank" rel="noreferrer">Get directions</a>
                  <button disabled={busy} onClick={() => void requestReschedule(upcoming.id)}>
                    {busy ? "Sending…" : "Request reschedule"}
                  </button>
                </div>
              </div>
              <span className="confirmed-pill">✓ {upcoming.status}</span>
            </article>
          ) : (
            <article className="upcoming-card" id="appointments">
              <div>
                <p className="eyebrow">No upcoming booking</p>
                <h2>Let’s plan your next visit.</h2>
                <Link className="button admin-primary" href="/book">
                  Book appointment
                </Link>
              </div>
            </article>
          )}
          <article className="portal-membership">
            <p className="eyebrow">{membership?.plan.name ?? "Membership"}</p>
            <h2>{money(membership?.balanceMinor ?? 0)}</h2>
            <span>credit remaining</span>
            <div>
              <i>
                <b
                  style={{
                    width: membership
                      ? `${Math.min(100, (membership.balanceMinor / membership.plan.creditMinor) * 100)}%`
                      : "0%",
                  }}
                />
              </i>
              <small>
                {membership
                  ? `${money(membership.plan.creditMinor - membership.balanceMinor)} used of ${money(membership.plan.creditMinor)}`
                  : "No active plan"}
              </small>
            </div>
            <a href="#history">View ledger →</a>
          </article>
        </div>
        <section className="portal-loyalty-card">
          <div>
            <p className="eyebrow">Loyalty rewards</p>
            <h2>{data.loyaltyPoints.toLocaleString("en-IN")} points</h2>
            <p>Worth {money(data.loyaltyPoints * data.loyaltyRules.redeemMinorPerPoint)} at POS. Redeem from {data.loyaltyRules.minRedeemPoints} points.</p>
          </div>
          <div>
            <strong>Recent points activity</strong>
            {(data.loyaltyLedger ?? []).slice(0, 3).map((entry) => (
              <span key={entry.id}><b>{entry.deltaPoints > 0 ? "+" : ""}{entry.deltaPoints}</b><small>{entry.reason} · balance {entry.balanceAfter}</small></span>
            ))}
            {!data.loyaltyLedger?.length && <small>Your points activity will appear here.</small>}
          </div>
        </section>
        {servicePackages.length > 0 && (
          <section className="portal-packages">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Prepaid services</p>
                <h2>Your active packages</h2>
              </div>
            </div>
            <div className="portal-package-grid">
              {servicePackages.map((enrollment) => (
                <article key={enrollment.id}>
                  <p className="eyebrow">{enrollment.package.name}</p>
                  <strong>{money(enrollment.package.priceMinor)}</strong>
                  <ul>
                    {enrollment.package.items.map((item) => {
                      const balance = enrollment.ledger
                        .filter((entry) => entry.serviceId === item.serviceId)
                        .reduce((sum, entry) => sum + entry.qtyDelta, 0);
                      return (
                        <li key={item.id}>
                          <span>{item.service.name}</span>
                          <b>{balance} left</b>
                        </li>
                      );
                    })}
                  </ul>
                  <small>
                    {enrollment.expiresAt
                      ? `Valid until ${new Date(enrollment.expiresAt).toLocaleDateString("en-IN")}`
                      : "No expiry"}
                  </small>
                </article>
              ))}
            </div>
          </section>
        )}
        <section className="portal-history" id="history">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your history</p>
              <h2>Looks we’ve created together</h2>
            </div>
            <Link className="text-link" href="/book">
              Book again <span>↗</span>
            </Link>
          </div>
          <div className="history-timeline">
            {data.appointments.slice(0, 8).map((appointment, index) => (
              <article key={appointment.id}>
                <span className="timeline-mark">
                  {index === 0 ? "✦" : index + 1}
                </span>
                <time>
                  {new Date(appointment.startAt).toLocaleDateString("en-IN", {
                    day: "2-digit",
                    month: "short",
                  })}
                  <small>{new Date(appointment.startAt).getFullYear()}</small>
                </time>
                <div>
                  <strong>
                    {appointment.items
                      .map((item) => item.service.name)
                      .join(" + ")}
                  </strong>
                  <span>
                    {appointment.items
                      .map((item) => item.staff.displayName)
                      .join(", ")}
                  </span>
                  <em>{appointment.status}</em>
                </div>
                <Link href="/book">Book again</Link>
              </article>
            ))}
          </div>
        </section>
        <section className="invoice-strip" id="invoices">
          <div>
            <p className="eyebrow">Receipts & invoices</p>
            <h2>Everything in one place.</h2>
          </div>
          <div>
            {data.invoices.map((invoice) => (
              <div className="portal-invoice-row" key={invoice.id}>
                <span>
                  <strong>{invoice.number}</strong>
                  <small>
                    {new Date(invoice.createdAt).toLocaleDateString("en-IN")}
                  </small>
                </span>
                <b>{money(invoice.totalMinor)}</b>
                <i>{invoice.status}</i>
              </div>
            ))}
          </div>
        </section>
      </div>
      <nav className="portal-mobile-nav">
        <a className="active" href="#overview">
          Home
        </a>
        <a href="#appointments">Bookings</a>
        <Link href="/book" className="mobile-book">
          ＋
        </Link>
        <a href="#history">History</a>
        <a href="#invoices">Profile</a>
      </nav>
    </main>
  );
}
