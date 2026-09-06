"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import BrandLogo from "../components/BrandLogo";
import { backendApi, type CustomerPortalOverview, type CustomerRewardDrawResult } from "../../lib/backend-api";

const money = (minor: number) =>
  `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;
const CUSTOMER_TOKEN_KEY = "cutz.customer.token";
const rewardSlices = ["₹25", "Better luck", "Free add-on", "₹50", "Glow perk", "Try again", "VIP treat", "₹100"];
type RewardKind = "spin" | "scratch";
type RewardModalState = {
  kind: RewardKind;
  result?: CustomerRewardDrawResult;
  error?: string;
};

export default function CustomerPortal() {
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [data, setData] = useState<CustomerPortalOverview | null>(null);
  const [token, setToken] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [activeReward, setActiveReward] = useState<RewardKind | null>(null);
  const [drawResults, setDrawResults] = useState<Partial<Record<RewardKind, CustomerRewardDrawResult>>>({});
  const [rewardModal, setRewardModal] = useState<RewardModalState | null>(null);

  useEffect(() => {
    const savedToken = window.localStorage.getItem(CUSTOMER_TOKEN_KEY);
    const linkedPhone = new URLSearchParams(window.location.search).get("phone");
    if (linkedPhone) setPhone(linkedPhone);
    if (!savedToken) return;
    setBusy(true);
    backendApi
      .customerOverview(savedToken)
      .then((overview) => {
        setData(overview);
        setToken(savedToken);
      })
      .catch(() => {
        window.localStorage.removeItem(CUSTOMER_TOKEN_KEY);
      })
      .finally(() => setBusy(false));
  }, []);

  const requestOtp = async () => {
    setBusy(true);
    setMessage("");
    try {
      await backendApi.requestCustomerOtp(phone, "main");
      setOtpSent(true);
      setMessage("OTP sent on WhatsApp if this number is registered with the salon.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message.replaceAll("_", " ")
          : "OTP could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };

  const verifyOtp = async () => {
    setBusy(true);
    setMessage("");
    try {
      const session = await backendApi.verifyCustomerOtp(phone, otp, "main");
      setData(await backendApi.customerOverview(session.token));
      setToken(session.token);
      window.localStorage.setItem(CUSTOMER_TOKEN_KEY, session.token);
      setOtp("");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message.replaceAll("_", " ")
          : "OTP verification failed.",
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

  const playReward = async (kind: RewardKind) => {
    if (!token) return;
    setActiveReward(kind);
    setRewardModal({ kind });
    setMessage("");
    try {
      const result = await backendApi.playCustomerReward(token, kind);
      setDrawResults((current) => ({ ...current, [kind]: result }));
      setRewardModal({ kind, result });
      setMessage(result.message);
      setData(await backendApi.customerOverview(token));
    } catch (cause) {
      const error = cause instanceof Error ? cause.message.replaceAll("_", " ") : "Reward could not be opened.";
      setRewardModal({ kind, error });
      setMessage(error);
    } finally {
      setActiveReward(null);
    }
  };
  if (!data)
    return (
      <main className="portal-auth-shell">
        <Link className="wordmark" href="/">
          <BrandLogo priority />
        </Link>
        <section className="portal-auth-card">
          <p className="eyebrow">Customer portal</p>
          <h1>
            Your salon history,
            <br />
            <em>kept together.</em>
          </h1>
          <p>
            Enter your registered mobile number. We’ll send a one-time login
            code on WhatsApp so you can see invoices, loyalty points and stamp
            rewards.
          </p>
          <label>
            Mobile number
            <input
              inputMode="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="75100 20067"
            />
          </label>
          {otpSent && (
            <label>
              WhatsApp OTP
              <input
                inputMode="numeric"
                maxLength={6}
                value={otp}
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 digit code"
              />
            </label>
          )}
          <p className="portal-auth-help">
            New customer? Ask the salon desk to add your number first, then login here.
          </p>
          {message && <span className="portal-auth-error">{message}</span>}
          <button
            className="button admin-primary"
            disabled={busy || phone.replace(/\D/g, "").length < 10 || (otpSent && otp.length !== 6)}
            onClick={() => void (otpSent ? verifyOtp() : requestOtp())}
          >
            {busy ? "Please wait…" : otpSent ? "Verify OTP & open portal" : "Send WhatsApp OTP"}
          </button>
          {otpSent && (
            <button className="auth-mode-link" disabled={busy} onClick={() => void requestOtp()}>
              Resend OTP
            </button>
          )}
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
  const stampEveryVisits = Math.max(2, Math.min(50, Number(data.marketingSettings?.rewardRules?.stampEveryVisits ?? 5)));
  const paidInvoiceCount = data.invoices.filter((invoice) => invoice.status === "PAID").length;
  const stampProgress = paidInvoiceCount % stampEveryVisits || (paidInvoiceCount > 0 ? stampEveryVisits : 0);
  const nextStampCount = stampEveryVisits - (stampProgress === stampEveryVisits ? 0 : stampProgress);
  const spinWin = data.loyaltyLedger.find((entry) => entry.reason.toLowerCase().includes("spin"));
  const scratchWin = data.loyaltyLedger.find((entry) => entry.reason.toLowerCase().includes("scratch"));
  const rewardModalResult = rewardModal?.result;
  const rewardModalLoading = rewardModal ? activeReward === rewardModal.kind && !rewardModal.result && !rewardModal.error : false;
  const rewardModalTitle = rewardModal?.error
    ? "Reward could not open"
    : rewardModalResult?.won
      ? "You’re a lucky winner!"
      : rewardModalResult
        ? "Better luck next time!"
        : rewardModal?.kind === "spin"
          ? "Spin & win"
          : "Scratch & win";
  return (
    <main className="portal-shell customer-portal">
      <header className="portal-header">
        <Link className="wordmark" href="/">
          <BrandLogo />
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
          <button onClick={() => { if (token) void backendApi.logout(token).catch(() => undefined); setData(null); setToken(""); setDrawResults({}); }}>Sign out</button>
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
        <section className="portal-reward-grid">
          <article className="portal-stamp-card">
            <div>
              <p className="eyebrow">Digital stamp card</p>
              <h2>{stampProgress}/{stampEveryVisits}</h2>
              <p>
                Every paid invoice adds a stamp. {nextStampCount === 0
                  ? "Milestone reached—reward is added from the POS rules."
                  : `${nextStampCount} more paid visit${nextStampCount === 1 ? "" : "s"} for the next stamp reward.`}
              </p>
            </div>
            <div className="stamp-row" aria-label={`${stampProgress} of ${stampEveryVisits} stamps`}>
              {Array.from({ length: stampEveryVisits }).map((_, index) => (
                <span className={index < stampProgress ? "filled" : ""} key={index}>✦</span>
              ))}
            </div>
          </article>
          <article className="portal-draw-card">
            <p className="eyebrow">Spin & scratch rewards</p>
            <h2>{spinWin || scratchWin || drawResults.spin?.won || drawResults.scratch?.won ? "Prize unlocked" : "Try your luck today"}</h2>
            <p>
              Spin and scratch are open even before your first invoice. One safe try per reward is allowed each day.
            </p>
            <div className="portal-draw-actions">
              <button disabled={activeReward !== null || busy} onClick={() => void playReward("spin")}>
                <span>🎡</span>
                {activeReward === "spin" ? "Spinning…" : "Spin & Win"}
              </button>
              <button disabled={activeReward !== null || busy} onClick={() => void playReward("scratch")}>
                <span>🎁</span>
                {activeReward === "scratch" ? "Opening…" : "Scratch Card"}
              </button>
            </div>
            <div className="portal-draw-status">
              <span>{drawResults.spin ? drawResults.spin.message : spinWin ? `Spin won +${spinWin.deltaPoints}` : "Spin: ready today"}</span>
              <span>{drawResults.scratch ? drawResults.scratch.message : scratchWin ? `Scratch won +${scratchWin.deltaPoints}` : "Scratch: ready today"}</span>
            </div>
          </article>
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
      {rewardModal && (
        <div className={`reward-modal-backdrop ${rewardModalResult?.won ? "is-win" : rewardModalResult ? "is-miss" : ""}`} role="dialog" aria-modal="true" aria-live="polite">
          <div className={`reward-modal ${rewardModal.kind === "scratch" ? "scratch-mode" : "spin-mode"}`}>
            <button className="reward-modal-close" type="button" aria-label="Close reward popup" onClick={() => setRewardModal(null)}>
              ×
            </button>
            <div className="reward-party" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="reward-modal-copy">
              <p className="eyebrow">{rewardModal.kind === "spin" ? "Welcome to" : "Scratch your"}</p>
              <h2>{rewardModalTitle}</h2>
              <p>
                {rewardModal.error
                  ? rewardModal.error
                  : rewardModalLoading
                    ? rewardModal.kind === "spin"
                      ? "The wheel is spinning…"
                      : "Opening your lucky card…"
                    : rewardModalResult?.won
                      ? `Boom! ${rewardModalResult.points} loyalty points are added to your salon wallet.`
                      : "No prize this round, but your next daily try opens tomorrow."}
              </p>
            </div>
            {rewardModal.kind === "spin" ? (
              <div className="spin-wheel-stage">
                <div className="spin-pointer" aria-hidden="true" />
                <div
                  className={`spin-wheel ${rewardModalLoading ? "is-spinning" : ""}`}
                  style={rewardModalResult ? { transform: `rotate(${720 + ((rewardModalResult.roll * 37) % 360)}deg)` } : undefined}
                >
                  {rewardSlices.map((slice, index) => (
                    <span
                      key={slice}
                      style={{ transform: `rotate(${index * (360 / rewardSlices.length)}deg) translateY(-96px) rotate(90deg)` }}
                    >
                      {slice}
                    </span>
                  ))}
                  <b>SPIN<br />WIN</b>
                </div>
              </div>
            ) : (
              <div className={`scratch-prize-card ${rewardModalResult || rewardModal.error ? "is-revealed" : ""}`}>
                <div>
                  <strong>SCRATCH<br />& WIN</strong>
                  <span>Good luck!</span>
                </div>
                <section>
                  <i>🎁</i>
                  <b>
                    {rewardModalLoading
                      ? "Scratch here"
                      : rewardModalResult?.won
                        ? `Winner +${rewardModalResult.points}`
                        : "Better luck"}
                  </b>
                  <small>{rewardModalResult?.won ? "Points added" : rewardModalResult ? "Try again tomorrow" : "Revealing…"}</small>
                </section>
              </div>
            )}
            <div className="reward-modal-actions">
              <button className="button admin-primary" type="button" onClick={() => setRewardModal(null)}>
                {rewardModalResult || rewardModal.error ? "Done" : "Please wait…"}
              </button>
              {rewardModalResult && (
                <small>
                  Daily attempt saved · balance {rewardModalResult.balanceAfter.toLocaleString("en-IN")} points
                </small>
              )}
            </div>
          </div>
        </div>
      )}
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
