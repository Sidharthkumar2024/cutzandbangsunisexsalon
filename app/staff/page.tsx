"use client";

import { useState } from "react";
import Link from "next/link";
import { backendApi, type StaffPortalDay } from "../../lib/backend-api";

const money = (minor: number) =>
  `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;

export default function StaffPortal() {
  const [email, setEmail] = useState("riya@cutzbangs.local");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [data, setData] = useState<StaffPortalDay | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const signIn = async () => {
    setBusy(true);
    setMessage("");
    try {
      const session = await backendApi.login(email, password);
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
  if (!data)
    return (
      <main className="portal-auth-shell staff-auth">
        <Link className="wordmark" href="/">
          <span>CUTZ</span>
          <i>&</i>
          <span>BANGS</span>
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
          <span>CUTZ</span>
          <i>&</i>
          <span>BANGS</span>
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
            <Link href="/admin">Open attendance</Link>
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
            <strong>{money(data.performance.serviceRevenueMinor)}</strong>
            <p>
              {money(data.performance.estimatedCommissionMinor)} est. commission
            </p>
          </article>
          <article>
            <span>CL</span>
            <small>Clients seen</small>
            <strong>{completed}</strong>
            <p>{data.appointments.length - completed} remaining</p>
          </article>
        </div>
        <section className="staff-schedule" id="day">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Your schedule</p>
              <h2>Today, at a glance</h2>
            </div>
            <button>Full calendar →</button>
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
                      <button>View history</button>
                      <button>Message</button>
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
