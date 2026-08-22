"use client";

import { useEffect, useState } from "react";
import { api, money, ApiError } from "@/lib/api";

interface Service { id: string; name: string; durationMin: number; priceMinor: number; }
interface Category { id: string; name: string; gender: string | null; services: Service[]; }
interface Staff { id: string; displayName: string; }

// Single-branch MVP; multi-branch selection can be added later.
const BRANCH_ID = process.env.NEXT_PUBLIC_BRANCH_ID ?? "main";

export default function BookPage() {
  const [step, setStep] = useState(1);
  const [categories, setCategories] = useState<Category[]>([]);
  const [service, setService] = useState<Service | null>(null);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState<string>("");
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [slots, setSlots] = useState<string[]>([]);
  const [slot, setSlot] = useState<string>("");
  const [guest, setGuest] = useState({ name: "", phone: "", email: "" });
  const [error, setError] = useState<string>("");
  const [done, setDone] = useState<{ id: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<Category[]>("/services").then(setCategories).catch(() => setError("Could not load services"));
  }, []);

  async function pickService(s: Service) {
    setService(s);
    setError("");
    const st = await api<Staff[]>(`/staff?serviceId=${s.id}&branchId=${BRANCH_ID}`);
    setStaff(st);
    setStep(2);
  }

  async function pickStaff(id: string) {
    setStaffId(id);
    await loadSlots(id, date);
    setStep(3);
  }

  async function loadSlots(sid: string, d: string) {
    if (!service) return;
    setLoading(true);
    setSlot("");
    try {
      const res = await api<{ slots: string[] }>(
        `/availability?branchId=${BRANCH_ID}&serviceId=${service.id}&staffId=${sid}&date=${d}`,
      );
      setSlots(res.slots);
    } finally {
      setLoading(false);
    }
  }

  async function submit() {
    if (!service || !slot) return;
    setError("");
    setLoading(true);
    try {
      const appt = await api<{ id: string }>("/bookings", {
        method: "POST",
        body: {
          branchId: BRANCH_ID,
          guest: { name: guest.name, phone: guest.phone, email: guest.email || undefined },
          items: [{ serviceId: service.id, staffId, startAt: slot }],
        },
      });
      setDone(appt);
      setStep(5);
    } catch (e) {
      const err = e as ApiError;
      setError(
        err.status === 409
          ? "That slot was just taken — please pick another time."
          : "Something went wrong. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <main className="container" style={{ padding: "48px 20px", maxWidth: 560 }}>
        <div className="card">
          <h2>You&apos;re booked! ✂️</h2>
          <p className="muted">
            {service?.name} on {new Date(slot).toLocaleString("en-IN")}. We&apos;ll send a reminder before your
            visit. Reference: {done.id.slice(-6)}.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="container" style={{ padding: "40px 20px", maxWidth: 640 }}>
      <h1>Book an appointment</h1>
      <p className="muted">Step {Math.min(step, 4)} of 4</p>
      {error && <p className="err">{error}</p>}

      {step === 1 && (
        <div>
          {categories.map((cat) => (
            <div key={cat.id} style={{ marginTop: 20 }}>
              <h3>{cat.name}</h3>
              {cat.services.map((s) => (
                <div key={s.id} className="card row" style={{ justifyContent: "space-between", marginBottom: 10 }}>
                  <div>
                    <strong>{s.name}</strong>
                    <div className="muted">{s.durationMin} min · {money(s.priceMinor)}</div>
                  </div>
                  <button className="btn" onClick={() => pickService(s)}>Select</button>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {step === 2 && (
        <div style={{ marginTop: 16 }}>
          <h3>Choose your stylist</h3>
          <div className="row">
            {staff.map((s) => (
              <button key={s.id} className="pill-choice" onClick={() => pickStaff(s.id)}>
                {s.displayName}
              </button>
            ))}
            {staff.length === 0 && <p className="muted">No stylist available for this service.</p>}
          </div>
        </div>
      )}

      {step === 3 && (
        <div style={{ marginTop: 16 }}>
          <h3>Pick a time</h3>
          <label>Date</label>
          <input
            type="date"
            value={date}
            onChange={(e) => { setDate(e.target.value); loadSlots(staffId, e.target.value); }}
          />
          <div className="row" style={{ marginTop: 16 }}>
            {loading && <p className="muted">Loading…</p>}
            {!loading && slots.length === 0 && <p className="muted">No free slots on this day.</p>}
            {slots.map((s) => (
              <button
                key={s}
                className={`pill-choice ${slot === s ? "active" : ""}`}
                onClick={() => setSlot(s)}
              >
                {new Date(s).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
              </button>
            ))}
          </div>
          <button className="btn" style={{ marginTop: 20 }} disabled={!slot} onClick={() => setStep(4)}>
            Continue
          </button>
        </div>
      )}

      {step === 4 && (
        <div style={{ marginTop: 16 }}>
          <h3>Your details</h3>
          <label>Name</label>
          <input value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} />
          <label>Phone</label>
          <input value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} />
          <label>Email (optional)</label>
          <input value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} />
          <button
            className="btn"
            style={{ marginTop: 20 }}
            disabled={!guest.name || !guest.phone || loading}
            onClick={submit}
          >
            {loading ? "Booking…" : "Confirm booking"}
          </button>
        </div>
      )}
    </main>
  );
}
