"use client";

import { useState } from "react";
import Link from "next/link";
import { backendApi, type StaffPortalDay } from "../../lib/backend-api";
import BrandLogo from "../components/BrandLogo";

const money = (minor: number) =>
  `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;

export default function StaffPortal() {
  const [email, setEmail] = useState("riya@cutzbangs.local");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [data, setData] = useState<StaffPortalDay | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [rangeDays, setRangeDays] = useState(1);
  const [attendanceSelfie, setAttendanceSelfie] = useState<File | null>(null);
  const [attendanceConsent, setAttendanceConsent] = useState(false);
  const [leaveFrom, setLeaveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [leaveTo, setLeaveTo] = useState(new Date().toISOString().slice(0, 10));
  const [leaveReason, setLeaveReason] = useState("");
  const signIn = async () => {
    setBusy(true);
    setMessage("");
    try {
      const session = await backendApi.login(email, password);
      if ("twoFactorRequired" in session && session.twoFactorRequired)
        throw new Error("two_factor_verification_required");
      if (session.user.role !== "STAFF")
        throw new Error("staff_account_required");
      setToken(session.token);
      setData(await backendApi.staffMyDay(session.token));
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
  const changeStatus = async (appointmentId: string, status: string) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateAppointmentStatus(token, appointmentId, status);
      setData(await backendApi.staffMyDay(token));
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message.replaceAll("_", " ")
          : "Status update failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const loadRange = async (days: number) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      const to = new Date(from.getTime() + days * 86_400_000);
      setData(await backendApi.staffMyDay(token, from.toISOString(), to.toISOString()));
      setRangeDays(days);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Schedule could not be loaded.");
    } finally {
      setBusy(false);
    }
  };
  const viewCustomerHistory = async (customerId?: string) => {
    if (!token || !customerId) return;
    setBusy(true);
    try {
      const customer = await backendApi.customerDetail(token, customerId);
      setMessage(`${customer.name}: ${customer.visitCount} visits · ${customer.loyaltyPoints} loyalty points · ${customer.appointments.length} appointments in history.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Customer history could not be loaded.");
    } finally {
      setBusy(false);
    }
  };
  const recordAttendance = async (mode: "check-in" | "check-out") => {
    if (!token || !attendanceSelfie || !attendanceConsent) return;
    setBusy(true); setMessage("");
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 15_000 }));
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(attendanceSelfie);
      });
      const upload = await backendApi.uploadMedia(token, { purpose: "attendance-selfie", contentType: attendanceSelfie.type, base64, consent: true });
      const result = await backendApi.attendance(token, mode, { lat: position.coords.latitude, lng: position.coords.longitude, selfieKey: upload.key, consent: true });
      setAttendanceSelfie(null); setAttendanceConsent(false);
      setMessage(`${mode === "check-in" ? "Check-in" : "Check-out"} saved inside the ${Math.round(result.distanceMeters ?? 0)}m salon geofence.`);
      setData(await backendApi.staffMyDay(token));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Attendance could not be saved."); }
    finally { setBusy(false); }
  };
  const requestLeave = async () => {
    if (!token || !leaveReason.trim()) return;
    setBusy(true); setMessage("");
    try {
      await backendApi.createLeave(token, { startDate: leaveFrom, endDate: leaveTo, reason: leaveReason });
      setLeaveReason(""); setMessage("Leave request sent to the manager for approval."); setData(await backendApi.staffMyDay(token));
    } catch (cause) { setMessage(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Leave request failed."); }
    finally { setBusy(false); }
  };
  if (!data)
    return (
      <main className="portal-auth-shell staff-auth">
        <Link className="wordmark" href="/">
          <BrandLogo priority />
        </Link>
        <section className="portal-auth-card">
          <p className="eyebrow">Staff portal</p>
          <h1>
            Your day,
            <br />
            <em>securely assigned.</em>
          </h1>
          <p>
            Only your appointments, attendance, notifications and commission are
            returned by the backend.
          </p>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Staff account password"
            />
          </label>
          <Link className="auth-mode-link" href="/forgot-password">Forgot password?</Link>
          {message && <span className="portal-auth-error">{message}</span>}
          <button
            className="button admin-primary"
            disabled={!email || !password || busy}
            onClick={() => void signIn()}
          >
            {busy ? "Opening portal…" : "Sign in"}
          </button>
        </section>
      </main>
    );

  const checkedIn = data.attendance.some(
    (row) => row.checkInAt && !row.checkOutAt,
  );
  const completed = data.appointments.filter(
    (item) => item.status === "COMPLETED",
  ).length;
  return (
    <main className="staff-portal-shell">
      <aside className="staff-sidebar">
        <Link className="wordmark" href="/">
          <BrandLogo />
        </Link>
        <nav>
          <a className="active" href="#day">
            <span>MY</span>My day
          </a>
          <a href="#calendar">
            <span>CA</span>Calendar
          </a>
          <a href="#customers">
            <span>CU</span>Customers
          </a>
          <a href="#commission">
            <span>₹</span>Commission
          </a>
          <a href="#notifications">
            <span>NO</span>Notifications<b>{data.notifications.length}</b>
          </a>
        </nav>
        <div className="staff-side-profile">
          <span>
            {data.staff.displayName
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2)}
          </span>
          <div>
            <strong>{data.staff.displayName}</strong>
            <small>Secure staff account</small>
          </div>
          <button
            onClick={() => {
              if (token) void backendApi.logout(token).catch(() => undefined);
              setData(null);
              setToken("");
            }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <section className="staff-main">
        {message && <div className="calendar-message">{message}</div>}
        <header>
          <div>
            <p className="eyebrow">
              {new Date().toLocaleDateString("en-IN", {
                weekday: "long",
                day: "numeric",
                month: "long",
              })}
            </p>
            <h1>Good morning, {data.staff.displayName.split(" ")[0]}.</h1>
            <p>
              You have {data.appointments.length} appointments assigned by the
              live scheduling engine.
            </p>
          </div>
          <div className={`checkin-card ${checkedIn ? "active" : ""}`}>
            <span>{checkedIn ? "✓" : "○"}</span>
            <p>
              <small>{checkedIn ? "Checked in" : "Not checked in"}</small>
              <strong>
                {checkedIn
                  ? new Date(
                      data.attendance.find((row) => !row.checkOutAt)
                        ?.checkInAt ?? "",
                    ).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : "—"}
              </strong>
            </p>
            <label className="staff-selfie-button">Add live selfie<input type="file" accept="image/jpeg,image/png,image/webp" capture="user" onChange={(event) => setAttendanceSelfie(event.target.files?.[0] ?? null)} /></label>
            <label className="staff-consent"><input type="checkbox" checked={attendanceConsent} onChange={(event) => setAttendanceConsent(event.target.checked)} /> Location + selfie consent</label>
            <button disabled={busy || !attendanceSelfie || !attendanceConsent} onClick={() => void recordAttendance(checkedIn ? "check-out" : "check-in")}>{checkedIn ? "Check out" : "Check in"}</button>
          </div>
        </header>
        <div className="staff-kpis">
          <article>
            <span>CA</span>
            <small>Appointments</small>
            <strong>{data.appointments.length}</strong>
            <p>Today’s live assignments</p>
          </article>
          <article id="commission">
            <span>₹</span>
            <small>Today’s sales</small>
            <strong>{money(data.performance.serviceRevenueMinor + data.performance.productRevenueMinor)}</strong>
            <p>
              {money(data.performance.estimatedCommissionMinor)} est. commission · {money(data.performance.productCommissionMinor)} retail
            </p>
          </article>
          <article>
            <span>CL</span>
            <small>Clients seen</small>
            <strong>{completed}</strong>
            <p>{data.appointments.length - completed} remaining</p>
          </article>
          <article>
            <span>MB</span>
            <small>Plans sold</small>
            <strong>{(data.performance.membershipsSold ?? 0) + (data.performance.packagesSold ?? 0)}</strong>
            <p>{data.performance.membershipsSold ?? 0} memberships · {data.performance.packagesSold ?? 0} packages</p>
          </article>
        </div>
        <section className="staff-work-policy">
          <article>
            <p className="eyebrow">Work policy</p>
            <h2>{data.staff.designation ?? "Stylist"}</h2>
            <div className="staff-policy-facts"><span><small>Base salary</small><strong>{money(data.staff.baseSalaryMinor ?? 0)}</strong></span><span><small>Service commission</small><strong>{(data.performance.commissionRateBps ?? 0) / 100}%</strong></span><span><small>Starts after sales</small><strong>{money(data.performance.commissionThresholdMinor ?? 0)}</strong></span><span><small>Weekly off</small><strong>{(data.staff.weeklyOff ?? []).map((day) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][day]).join(", ") || "Not set"}</strong></span></div>
            <div className="staff-shift-list">{(data.staff.shifts ?? []).map((shift) => <span key={`${shift.weekday}-${shift.startMin}`}><b>{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][shift.weekday]}</b>{String(Math.floor(shift.startMin / 60)).padStart(2, "0")}:{String(shift.startMin % 60).padStart(2, "0")}–{String(Math.floor(shift.endMin / 60)).padStart(2, "0")}:{String(shift.endMin % 60).padStart(2, "0")}</span>)}</div>
          </article>
          <article>
            <p className="eyebrow">Leave request</p><h2>Plan time away</h2>
            <div className="staff-leave-form"><label>From<input type="date" value={leaveFrom} onChange={(event) => setLeaveFrom(event.target.value)} /></label><label>To<input type="date" min={leaveFrom} value={leaveTo} onChange={(event) => setLeaveTo(event.target.value)} /></label><label>Reason<input value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} placeholder="Reason for leave" /></label><button disabled={busy || !leaveReason.trim() || leaveTo < leaveFrom} onClick={() => void requestLeave()}>Send request</button></div>
            <div className="staff-leave-history">{(data.staff.leaves ?? []).slice(0, 5).map((leave) => <span key={leave.id}><strong>{new Date(leave.startDate).toLocaleDateString("en-IN")} → {new Date(leave.endDate).toLocaleDateString("en-IN")}</strong><small>{leave.reason} · {leave.approved ? "Approved" : "Pending"}</small></span>)}{!data.staff.leaves?.length && <small>No leave requests yet.</small>}</div>
          </article>
        </section>
        <section className="staff-schedule" id="day">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your schedule</p>
              <h2>{rangeDays === 1 ? "Today, at a glance" : "Your next 7 days"}</h2>
            </div>
            <button disabled={busy} onClick={() => void loadRange(rangeDays === 1 ? 7 : 1)}>
              {rangeDays === 1 ? "Full week →" : "Today only"}
            </button>
          </div>
          <div className="staff-timeline">
            {data.appointments.map((item) => {
              const done = item.status === "COMPLETED";
              const start = new Date(item.startAt);
              return (
                <article className={done ? "done" : ""} key={item.id}>
                  <time>
                    {start.toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    <small>
                      {start
                        .toLocaleTimeString("en-IN", { hour12: true })
                        .slice(-2)}
                    </small>
                  </time>
                  <span className="staff-line">
                    <i />
                  </span>
                  <div className="staff-appointment">
                    <header>
                      <span>
                        {(item.customer?.name ?? item.guestName ?? "Guest")
                          .split(" ")
                          .map((word) => word[0])
                          .join("")
                          .slice(0, 2)}
                      </span>
                      <div>
                        <h3>
                          {item.customer?.name ?? item.guestName ?? "Guest"}
                        </h3>
                        <p>
                          {item.items
                            .map((entry) => entry.service.name)
                            .join(" + ")}
                        </p>
                      </div>
                      <em>{item.status.replaceAll("_", " ")}</em>
                    </header>
                    <div className="client-note">
                      <span>✦</span>
                      <p>
                        <small>Customer context</small>
                        {item.customer?.phone ??
                          item.guestPhone ??
                          "No phone on file"}
                      </p>
                    </div>
                    <footer>
                      <button disabled={!item.customer?.id || busy} onClick={() => void viewCustomerHistory(item.customer?.id)}>View history</button>
                      <button
                        disabled={!item.customer?.phone && !item.guestPhone}
                        onClick={() => {
                          const phone = (item.customer?.phone ?? item.guestPhone ?? "").replace(/\D/g, "");
                          if (phone) window.open(`https://wa.me/${phone.startsWith("91") ? phone : `91${phone}`}`, "_blank", "noopener,noreferrer");
                        }}
                      >
                        Message
                      </button>
                      <button
                        className="primary"
                        disabled={busy}
                        onClick={() =>
                          void changeStatus(
                            item.id,
                            done ? "IN_SERVICE" : "COMPLETED",
                          )
                        }
                      >
                        {done ? "Reopen" : "Complete service"}
                      </button>
                    </footer>
                  </div>
                </article>
              );
            })}
            {!data.appointments.length && (
              <p className="empty-cart">No appointments assigned today.</p>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
