"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { backendApi, type BackendService } from "../../lib/backend-api";
import { submitBooking } from "../../lib/client-api";

type ServiceOption = BackendService & {
  category: string;
  gender?: string | null;
};

const fallbackServices: ServiceOption[] = [
  {
    id: "cut-style",
    category: "Hair",
    name: "Signature cut & style",
    durationMin: 60,
    priceMinor: 79900,
    taxRateBps: 1800,
    serviceStaff: [
      { staff: { id: "riya", displayName: "Riya Sen" } },
      { staff: { id: "arjun", displayName: "Arjun Khanna" } },
    ],
  },
  {
    id: "global-colour",
    category: "Colour",
    name: "Global colour ritual",
    durationMin: 120,
    priceMinor: 249900,
    taxRateBps: 1800,
    serviceStaff: [{ staff: { id: "riya", displayName: "Riya Sen" } }],
  },
  {
    id: "hair-spa",
    category: "Hair",
    name: "Restorative hair spa",
    durationMin: 75,
    priceMinor: 129900,
    taxRateBps: 1800,
    serviceStaff: [
      { staff: { id: "riya", displayName: "Riya Sen" } },
      { staff: { id: "arjun", displayName: "Arjun Khanna" } },
    ],
  },
  {
    id: "skin-reset",
    category: "Skin",
    name: "Skin reset facial",
    durationMin: 75,
    priceMinor: 149900,
    taxRateBps: 1800,
    serviceStaff: [{ staff: { id: "meher", displayName: "Meher Malik" } }],
  },
  {
    id: "beard-sculpt",
    category: "Grooming",
    name: "Beard sculpt & care",
    durationMin: 35,
    priceMinor: 49900,
    taxRateBps: 1800,
    serviceStaff: [{ staff: { id: "arjun", displayName: "Arjun Khanna" } }],
  },
];

const stepLabels = ["Services", "Artists", "Time", "Details"];
const initials = (name: string) =>
  name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
const isoDate = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dates = Array.from({ length: 7 }, (_, offset) => {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  return {
    value: isoDate(date),
    label: date.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
    }),
  };
});
const fallbackSlots = (date: string) =>
  ["10:00", "11:30", "13:00", "15:30", "16:30", "18:00"].map((time) =>
    new Date(`${date}T${time}:00+05:30`).toISOString(),
  );

export default function BookingPage() {
  const [step, setStep] = useState(0);
  const [audience, setAudience] = useState("All services");
  const [services, setServices] = useState<ServiceOption[]>(fallbackServices);
  const [selected, setSelected] = useState<string[]>(["cut-style"]);
  const [assignments, setAssignments] = useState<Record<string, string>>({
    "cut-style": "arjun",
  });
  const [date, setDate] = useState(dates[0].value);
  const [slots, setSlots] = useState<string[]>(fallbackSlots(dates[0].value));
  const [time, setTime] = useState(fallbackSlots(dates[0].value)[0]);
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [catalogLive, setCatalogLive] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    backendApi
      .publicCatalog()
      .then((categories) => {
        if (cancelled) return;
        const live = categories.flatMap((category) =>
          category.services.map((service) => ({
            ...service,
            category: category.name,
            gender: category.gender,
          })),
        );
        if (!live.length) return;
        setServices(live);
        setCatalogLive(true);
        setSelected((current) => {
          const valid = current.filter((id) =>
            live.some((service) => service.id === id),
          );
          return valid.length ? valid : [live[0].id];
        });
        setAssignments((current) => {
          const next = { ...current };
          for (const service of live)
            if (!next[service.id] && service.serviceStaff[0])
              next[service.id] = service.serviceStaff[0].staff.id;
          return next;
        });
      })
      .catch(() => setCatalogLive(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleServices = useMemo(
    () =>
      services.filter((service) => {
        if (
          audience === "All services" ||
          !service.gender ||
          service.gender.toLowerCase() === "unisex"
        )
          return true;
        return service.gender
          .toLowerCase()
          .includes(audience === "For her" ? "female" : "male");
      }),
    [audience, services],
  );
  const chosen = services.filter((service) => selected.includes(service.id));
  const total = chosen.reduce((sum, service) => sum + service.priceMinor, 0);
  const duration = chosen.reduce(
    (sum, service) => sum + service.durationMin,
    0,
  );
  const canContinue =
    step === 0
      ? selected.length > 0
      : step === 1
        ? chosen.every((service) => assignments[service.id])
        : step === 2
          ? Boolean(time)
          : name.trim().length > 1 && phone.trim().length >= 8;
  const assignmentKey = chosen
    .map((service) => `${service.id}:${assignments[service.id] ?? ""}`)
    .join(",");

  useEffect(() => {
    if (
      step < 2 ||
      !chosen.length ||
      chosen.some((service) => !assignments[service.id])
    )
      return;
    let cancelled = false;
    Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setAvailabilityLoading(true);
          setError("");
        }
        return backendApi.multiAvailability({
          branchId: "main",
          date,
          items: chosen.map((service) => ({
            serviceId: service.id,
            staffId: assignments[service.id],
          })),
        });
      })
      .then((result) => {
        if (cancelled) return;
        setTimezone(result.timezone);
        setSlots(result.slots);
        setTime((current) =>
          result.slots.includes(current) ? current : (result.slots[0] ?? ""),
        );
      })
      .catch(() => {
        if (cancelled) return;
        const next = fallbackSlots(date);
        setSlots(next);
        setTime(next[0]);
        setError(
          "Live availability is temporarily offline; your final time will still be conflict-checked.",
        );
      })
      .finally(() => {
        if (!cancelled) setAvailabilityLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // assignmentKey is the stable primitive representation of the selected service/staff pairs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, date, assignmentKey]);

  const toggleService = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
    const service = services.find((item) => item.id === id);
    if (service && !assignments[id] && service.serviceStaff[0])
      setAssignments((current) => ({
        ...current,
        [id]: service.serviceStaff[0].staff.id,
      }));
  };

  const continueFlow = async () => {
    setError("");
    if (!canContinue) return;
    if (step < 3) {
      setStep((current) => current + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setLoading(true);
    try {
      const result = await submitBooking({
        audience,
        services: chosen.map((service) => ({
          id: service.id,
          staffId: assignments[service.id],
        })),
        date: dates.find((item) => item.value === date)?.label ?? date,
        time: new Date(time).toLocaleTimeString("en-IN", {
          hour: "numeric",
          minute: "2-digit",
          timeZone: timezone,
        }),
        startAt: time,
        customer: { name, phone, email },
      });
      setReference(result.reference);
      setStep(4);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Something went wrong.",
      );
    } finally {
      setLoading(false);
    }
  };

  if (step === 4)
    return (
      <main className="booking-shell confirmation-shell">
        <Link className="booking-brand" href="/">
          <span>CUTZ</span>
          <i>&</i>
          <span>BANGS</span>
        </Link>
        <section className="confirmation-card">
          <div className="success-orbit">
            <span>✓</span>
          </div>
          <p className="eyebrow">You’re all set</p>
          <h1>See you in the chair, {name.split(" ")[0]}.</h1>
          <p>
            Your appointment is confirmed for{" "}
            <strong>
              {dates.find((item) => item.value === date)?.label} at{" "}
              {new Date(time).toLocaleTimeString("en-IN", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: timezone,
              })}
            </strong>
            . We’ll send the details to {phone}.
          </p>
          <div className="confirmation-reference">
            <span>Booking reference</span>
            <strong>{reference}</strong>
          </div>
          <div className="confirmation-actions">
            <Link className="button button-dark" href="/customer">
              View my appointments
            </Link>
            <Link className="text-link" href="/">
              Back to home <span>↗</span>
            </Link>
          </div>
        </section>
      </main>
    );

  return (
    <main className="booking-shell">
      <header className="booking-header">
        <Link className="booking-brand" href="/">
          <span>CUTZ</span>
          <i>&</i>
          <span>BANGS</span>
        </Link>
        <Link className="booking-close" href="/" aria-label="Close booking">
          ×
        </Link>
      </header>
      <div className="booking-layout">
        <section className="booking-main">
          <div
            className="booking-progress"
            aria-label={`Step ${step + 1} of 4`}
          >
            {stepLabels.map((label, index) => (
              <button
                key={label}
                className={
                  index === step ? "active" : index < step ? "complete" : ""
                }
                onClick={() => index < step && setStep(index)}
              >
                <span>{index < step ? "✓" : index + 1}</span>
                {label}
              </button>
            ))}
          </div>

          {step === 0 && (
            <div className="booking-panel">
              <p className="eyebrow">
                Step 1 of 4 ·{" "}
                {catalogLive ? "Live catalogue" : "Salon catalogue"}
              </p>
              <h1>What can we do for you?</h1>
              <div
                className="audience-switch"
                role="group"
                aria-label="Service audience"
              >
                {["For her", "For him", "All services"].map((option) => (
                  <button
                    key={option}
                    className={audience === option ? "active" : ""}
                    onClick={() => setAudience(option)}
                  >
                    {option}
                  </button>
                ))}
              </div>
              <div className="option-list">
                {visibleServices.map((service) => {
                  const isSelected = selected.includes(service.id);
                  return (
                    <button
                      className={`service-option ${isSelected ? "selected" : ""}`}
                      key={service.id}
                      onClick={() => toggleService(service.id)}
                      aria-pressed={isSelected}
                    >
                      <span className="option-check">
                        {isSelected ? "✓" : "+"}
                      </span>
                      <span className="option-copy">
                        <small>{service.category}</small>
                        <strong>{service.name}</strong>
                        <span>{service.durationMin} min</span>
                      </span>
                      <strong>
                        ₹
                        {Math.round(service.priceMinor / 100).toLocaleString(
                          "en-IN",
                        )}
                      </strong>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="booking-panel">
              <p className="eyebrow">Step 2 of 4</p>
              <h1>Choose an artist for each service.</h1>
              <p className="booking-lead">
                Only team members qualified for the selected service are shown.
              </p>
              <div className="artist-assignments">
                {chosen.map((service) => (
                  <article key={service.id}>
                    <div className="assignment-head">
                      <span className="option-check">✓</span>
                      <div>
                        <small>{service.category}</small>
                        <h3>{service.name}</h3>
                      </div>
                    </div>
                    <div className="artist-grid">
                      {service.serviceStaff.map(({ staff }) => (
                        <button
                          key={staff.id}
                          className={
                            assignments[service.id] === staff.id
                              ? "selected"
                              : ""
                          }
                          onClick={() =>
                            setAssignments((current) => ({
                              ...current,
                              [service.id]: staff.id,
                            }))
                          }
                        >
                          <span className="artist-avatar">
                            {initials(staff.displayName)}
                          </span>
                          <span>
                            <strong>{staff.displayName}</strong>
                            <small>Eligible salon artist</small>
                          </span>
                          <i>
                            {assignments[service.id] === staff.id ? "✓" : ""}
                          </i>
                        </button>
                      ))}
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="booking-panel">
              <p className="eyebrow">Step 3 of 4</p>
              <h1>Pick a time that feels good.</h1>
              <p className="booking-lead">
                Every displayed slot fits shifts, breaks, leave and existing
                bookings for all selected artists.
              </p>
              <div className="date-row">
                {dates.map((item) => {
                  const parts = item.label.replace(",", "").split(" ");
                  return (
                    <button
                      key={item.value}
                      className={date === item.value ? "selected" : ""}
                      onClick={() => setDate(item.value)}
                    >
                      <small>{parts[0]}</small>
                      <strong>{parts[1]}</strong>
                      <span>{parts[2]}</span>
                    </button>
                  );
                })}
              </div>
              <div className="slot-heading">
                <h3>Available times</h3>
                <span>
                  {availabilityLoading
                    ? "Checking live calendar…"
                    : `${Math.floor(duration / 60)}h ${duration % 60 ? `${duration % 60}m` : ""} total`}
                </span>
              </div>
              <div className="time-grid">
                {slots.map((slot) => (
                  <button
                    key={slot}
                    className={time === slot ? "selected" : ""}
                    onClick={() => setTime(slot)}
                  >
                    {new Date(slot).toLocaleTimeString("en-IN", {
                      hour: "numeric",
                      minute: "2-digit",
                      timeZone: timezone,
                    })}
                  </button>
                ))}
              </div>
              {!availabilityLoading && !slots.length && (
                <div className="availability-note">
                  <span>i</span>
                  <p>
                    <strong>No conflict-free time on this date.</strong>
                    <br />
                    Choose another date or artist.
                  </p>
                </div>
              )}
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="booking-panel">
              <p className="eyebrow">Step 4 of 4</p>
              <h1>Where should we send the details?</h1>
              <p className="booking-lead">
                No account needed. We’ll use these details only for this booking
                and its reminders.
              </p>
              <div className="booking-form">
                <label>
                  Full name
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Your name"
                    autoComplete="name"
                  />
                </label>
                <label>
                  Mobile number
                  <input
                    value={phone}
                    onChange={(event) => setPhone(event.target.value)}
                    placeholder="+91 98765 43210"
                    inputMode="tel"
                    autoComplete="tel"
                  />
                </label>
                <label>
                  Email <span>Optional</span>
                  <input
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    type="email"
                    autoComplete="email"
                  />
                </label>
                <label className="consent-row">
                  <input type="checkbox" defaultChecked />
                  <span>
                    Send appointment updates and reminders on WhatsApp/SMS.
                  </span>
                </label>
              </div>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
            </div>
          )}

          <div className="booking-footer">
            <button
              className="back-button"
              onClick={() => setStep((current) => Math.max(0, current - 1))}
              disabled={step === 0}
            >
              ← Back
            </button>
            <button
              className="button button-coral"
              disabled={!canContinue || loading || availabilityLoading}
              onClick={() => void continueFlow()}
            >
              {loading
                ? "Confirming…"
                : step === 3
                  ? "Confirm appointment"
                  : "Continue"}{" "}
              <span>→</span>
            </button>
          </div>
        </section>

        <aside className="booking-summary">
          <p className="eyebrow">Your visit</p>
          <h2>
            {chosen.length
              ? `${chosen.length} ${chosen.length === 1 ? "service" : "services"}`
              : "Choose a service"}
          </h2>
          <div className="summary-items">
            {chosen.map((service) => {
              const staff = service.serviceStaff.find(
                (entry) => entry.staff.id === assignments[service.id],
              )?.staff;
              return (
                <div key={service.id}>
                  <span>
                    <strong>{service.name}</strong>
                    <small>
                      {service.durationMin} min{" "}
                      {staff ? `· ${staff.displayName}` : ""}
                    </small>
                  </span>
                  <strong>
                    ₹
                    {Math.round(service.priceMinor / 100).toLocaleString(
                      "en-IN",
                    )}
                  </strong>
                </div>
              );
            })}
          </div>
          {step >= 2 && time && (
            <div className="summary-time">
              <span>◷</span>
              <p>
                <strong>
                  {dates.find((item) => item.value === date)?.label}
                </strong>
                <br />
                {new Date(time).toLocaleTimeString("en-IN", {
                  hour: "numeric",
                  minute: "2-digit",
                  timeZone: timezone,
                })}
              </p>
            </div>
          )}
          <div className="summary-total">
            <span>
              <small>Estimated total</small>
              <strong>
                ₹{Math.round(total / 100).toLocaleString("en-IN")}
              </strong>
            </span>
            <small>{duration} min</small>
          </div>
          <p className="summary-promise">
            Final confirmation uses the same conflict-safe engine as reception.
          </p>
        </aside>
      </div>
    </main>
  );
}
