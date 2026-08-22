"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type {
  FeaturedService,
  MembershipPlan,
  SiteContent,
  Testimonial,
} from "../../lib/content-types";
import { useBackendIntegration } from "../../lib/use-backend-integration";
import {
  backendApi,
  type BackendAppointment,
  type BackendCustomerDetail,
  type BackendRangeReport,
  type BackendSnapshot,
} from "../../lib/backend-api";

type View =
  | "dashboard"
  | "calendar"
  | "pos"
  | "customers"
  | "memberships"
  | "services"
  | "inventory"
  | "inbox"
  | "content"
  | "campaigns"
  | "reports"
  | "staff"
  | "attendance"
  | "payroll"
  | "settings";
type CartItem = {
  id: string;
  name: string;
  staff: string;
  staffId?: string;
  price: number;
};

const money = (minor: number) =>
  `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;
const prettyStatus = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
const toDateTimeInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const appointmentRow = (item: BackendAppointment, index = 0) => ({
  time: new Date(item.startAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
  }),
  name: item.customer?.name ?? item.guestName ?? "Walk-in",
  service:
    item.items.map((entry) => entry.service.name).join(" + ") || "Service",
  staff:
    item.items.map((entry) => entry.staff.displayName).join(", ") ||
    "Unassigned",
  status: prettyStatus(item.status),
  tone: ["mint", "lavender", "amber"][index % 3],
});

const navGroups: Array<{
  label: string;
  items: Array<{ id: View; label: string; icon: string }>;
}> = [
  {
    label: "Workspace",
    items: [
      { id: "dashboard", label: "Dashboard", icon: "DB" },
      { id: "calendar", label: "Calendar", icon: "CA" },
      { id: "pos", label: "Point of sale", icon: "₹" },
    ],
  },
  {
    label: "Relationships",
    items: [
      { id: "customers", label: "Customers", icon: "CU" },
      { id: "memberships", label: "Memberships", icon: "ME" },
      { id: "inbox", label: "Inbox", icon: "IN" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "services", label: "Services", icon: "SV" },
      { id: "inventory", label: "Inventory", icon: "IV" },
    ],
  },
  {
    label: "Growth",
    items: [
      { id: "content", label: "Website content", icon: "WC" },
      { id: "campaigns", label: "Campaigns", icon: "CP" },
      { id: "reports", label: "Reports", icon: "RP" },
    ],
  },
  {
    label: "Team",
    items: [
      { id: "staff", label: "Staff", icon: "ST" },
      { id: "attendance", label: "Attendance", icon: "AT" },
      { id: "payroll", label: "Payroll", icon: "PY" },
    ],
  },
];

const appointments = [
  {
    time: "10:00",
    name: "Aanya Mehta",
    service: "Global colour",
    staff: "Riya",
    status: "Checked in",
    tone: "mint",
  },
  {
    time: "11:30",
    name: "Kabir Sethi",
    service: "Cut & beard sculpt",
    staff: "Arjun",
    status: "Confirmed",
    tone: "lavender",
  },
  {
    time: "12:45",
    name: "Diya Rao",
    service: "Skin reset facial",
    staff: "Meher",
    status: "Pending",
    tone: "amber",
  },
  {
    time: "02:30",
    name: "Neha Kapoor",
    service: "Hair spa",
    staff: "Riya",
    status: "Confirmed",
    tone: "lavender",
  },
  {
    time: "04:30",
    name: "Mira Jain",
    service: "Signature cut",
    staff: "Arjun",
    status: "Confirmed",
    tone: "lavender",
  },
];

const customers = [
  {
    initials: "AM",
    name: "Aanya Mehta",
    phone: "+91 98990 14282",
    visits: 12,
    spend: "₹28,450",
    last: "Today",
    tags: ["VIP", "Repeat"],
  },
  {
    initials: "KS",
    name: "Kabir Sethi",
    phone: "+91 98112 76540",
    visits: 7,
    spend: "₹11,320",
    last: "Today",
    tags: ["Repeat"],
  },
  {
    initials: "DR",
    name: "Diya Rao",
    phone: "+91 99716 34218",
    visits: 1,
    spend: "₹1,499",
    last: "Today",
    tags: ["New"],
  },
  {
    initials: "NK",
    name: "Neha Kapoor",
    phone: "+91 88001 22876",
    visits: 9,
    spend: "₹19,760",
    last: "18 Aug",
    tags: ["At-risk"],
  },
  {
    initials: "RJ",
    name: "Rohan Joshi",
    phone: "+91 98102 44670",
    visits: 5,
    spend: "₹8,990",
    last: "12 May",
    tags: ["Lapsed"],
  },
];

const saleServices = [
  { id: "cut", name: "Signature cut", duration: "60m", price: 799 },
  { id: "colour", name: "Global colour", duration: "120m", price: 2499 },
  { id: "spa", name: "Hair spa", duration: "75m", price: 1299 },
  { id: "facial", name: "Skin reset", duration: "75m", price: 1499 },
  { id: "beard", name: "Beard sculpt", duration: "35m", price: 499 },
  { id: "manicure", name: "Manicure", duration: "45m", price: 699 },
];

const viewTitles: Record<View, [string, string]> = {
  dashboard: ["Good morning, Sana", "Here’s how Cutz & Bangs is doing today."],
  calendar: [
    "Booking calendar",
    "Live appointments, walk-ins and artist schedules.",
  ],
  pos: ["Point of sale", "Build, mark and issue a bill in a few taps."],
  customers: ["Customers", "One clear history across every booking and visit."],
  memberships: ["Memberships", "Plans, balances and immutable ledger entries."],
  services: [
    "Service catalogue",
    "Create bookable services and connect eligible artists.",
  ],
  inventory: [
    "Inventory",
    "Products, vendor bills, stock movements and reorder alerts.",
  ],
  inbox: ["Unified inbox", "WhatsApp, email and internal notes in one queue."],
  content: [
    "Website content",
    "Manage what customers see on the public website.",
  ],
  campaigns: [
    "Campaigns",
    "Reach the right audience with an approval-first workflow.",
  ],
  reports: ["Reports", "Sales, retention and service performance."],
  staff: ["Staff", "Skills, shifts, commission and availability."],
  attendance: [
    "Attendance",
    "GPS and consent-verified check-ins and check-outs.",
  ],
  payroll: [
    "Payroll foundation",
    "Attendance hours, service revenue and estimated commission.",
  ],
  settings: ["Settings", "Business, booking, payment and notification rules."],
};

export default function AdminPage() {
  const [view, setView] = useState<View>("dashboard");
  const [search, setSearch] = useState("");
  const [cart, setCart] = useState<CartItem[]>([
    { id: "cut-style", name: "Signature cut", staff: "Arjun", price: 799 },
  ]);
  const [memberCredit, setMemberCredit] = useState(false);
  const [paid, setPaid] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const backend = useBackendIntegration();
  const [title, subtitle] = viewTitles[view];
  const customerRows = backend.data.customers.length
    ? backend.data.customers.map((customer) => ({
        initials: customer.name
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2),
        name: customer.name,
        phone: customer.phone ?? "No phone",
        visits: customer.visitCount,
        spend: money(customer.totalSpent),
        last: customer.lastVisitAt
          ? new Date(customer.lastVisitAt).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
            })
          : "No visit",
        tags: customer.segments.map(prettyStatus),
      }))
    : customers;
  const filteredCustomers = customerRows.filter(
    (customer) =>
      customer.name.toLowerCase().includes(search.toLowerCase()) ||
      customer.phone.includes(search),
  );
  const liveServices = backend.data.categories
    .flatMap((category) => category.services)
    .map((service) => ({
      id: service.id,
      name: service.name,
      duration: `${service.durationMin}m`,
      price: service.priceMinor / 100,
    }));
  const pointOfSaleServices = liveServices.length ? liveServices : saleServices;
  const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
  // Membership credit is an auditable payment tender, not a discount. Invoice
  // tax and totals remain unchanged; redemption is posted to the ledger.
  const credit = 0;
  const tax = Math.round(subtotal * 0.18);
  const total = subtotal + tax;

  const selectView = (next: View) => {
    setView(next);
    setMobileNav(false);
    setPaid(false);
  };
  const addItem = (item: (typeof saleServices)[number]) => {
    const backendService = backend.data.categories
      .flatMap((category) => category.services)
      .find((service) => service.id === item.id);
    const staff =
      backendService?.serviceStaff[0]?.staff.displayName ??
      (item.id === "facial"
        ? "Meher"
        : item.id === "colour"
          ? "Riya"
          : "Arjun");
    setCart((current) => [
      ...current,
      {
        id: item.id,
        name: item.name,
        staff,
        staffId: backendService?.serviceStaff[0]?.staff.id,
        price: item.price,
      },
    ]);
  };

  return (
    <main className="admin-shell">
      <aside className={`admin-sidebar ${mobileNav ? "open" : ""}`}>
        <div className="admin-brand">
          <Link className="wordmark" href="/">
            <span>CUTZ</span>
            <i>&</i>
            <span>BANGS</span>
          </Link>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            ×
          </button>
        </div>
        <div className="branch-chip">
          <span>C&B</span>
          <div>
            <strong>DLF Phase 4</strong>
            <small>Gurugram · Open</small>
          </div>
          <i>⌄</i>
        </div>
        <nav aria-label="Admin navigation">
          {navGroups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={view === item.id ? "active" : ""}
                  onClick={() => selectView(item.id)}
                >
                  <span>{item.icon}</span>
                  {item.label}
                  {item.id === "inbox" && <b>6</b>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <button
          className={`sidebar-settings ${view === "settings" ? "active" : ""}`}
          onClick={() => selectView("settings")}
        >
          <span>SE</span>Settings
        </button>
        <div className="admin-user">
          <span>SS</span>
          <div>
            <strong>Sana Sharma</strong>
            <small>Owner</small>
          </div>
          <i>•••</i>
        </div>
      </aside>

      <section className="admin-content">
        <header className="admin-topbar">
          <div>
            <button className="mobile-menu" onClick={() => setMobileNav(true)}>
              ☰
            </button>
            <div>
              <h1>{title}</h1>
              <p>{subtitle}</p>
            </div>
          </div>
          <div className="admin-actions">
            <label className="global-search">
              <span>⌕</span>
              <input placeholder="Search anything…" />
            </label>
            <button className="icon-button" aria-label="Notifications">
              ●<b>3</b>
            </button>
            <button
              className="button admin-primary"
              onClick={() => selectView(view === "pos" ? "calendar" : "pos")}
            >
              {view === "pos" ? "+ New booking" : "+ New sale"}
            </button>
          </div>
        </header>
        <div className="admin-page">
          <BackendConnection backend={backend} />
          {view === "dashboard" && (
            <Dashboard onView={selectView} data={backend.data} />
          )}
          {view === "calendar" && (
            <Calendar
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "pos" && (
            <POS
              cart={cart}
              services={pointOfSaleServices}
              token={backend.token}
              data={backend.data}
              addItem={addItem}
              removeItem={(index) =>
                setCart((current) =>
                  current.filter((_, itemIndex) => itemIndex !== index),
                )
              }
              resetCart={() => setCart([])}
              subtotal={subtotal}
              credit={credit}
              tax={tax}
              total={total}
              memberCredit={memberCredit}
              setMemberCredit={setMemberCredit}
              paid={paid}
              setPaid={setPaid}
            />
          )}
          {view === "customers" && (
            <Customers
              token={backend.token}
              data={backend.data}
              search={search}
              setSearch={setSearch}
              items={filteredCustomers}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "memberships" && (
            <Memberships
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "services" && (
            <Services
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "inventory" && (
            <Inventory
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "inbox" && (
            <Inbox
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "content" && <WebsiteContent />}
          {view === "campaigns" && <Campaigns data={backend.data} />}
          {view === "reports" && <Reports report={backend.data.range} />}
          {view === "staff" && (
            <Staff
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "attendance" && (
            <Attendance
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {view === "payroll" && <Payroll data={backend.data} />}
          {view === "settings" && <Settings />}
        </div>
      </section>
    </main>
  );
}

function BackendConnection({
  backend,
}: {
  backend: ReturnType<typeof useBackendIntegration>;
}) {
  const [email, setEmail] = useState("owner@cutzbangs.local");
  const [password, setPassword] = useState("");
  if (backend.status === "connected")
    return (
      <div className="backend-banner connected">
        <span>●</span>
        <div>
          <strong>Backend live</strong>
          <small>Fastify · Postgres · Redis · {backend.data.user?.role}</small>
        </div>
        <button onClick={() => void backend.refresh()}>Refresh</button>
        <button onClick={backend.logout}>Disconnect</button>
      </div>
    );
  return (
    <form
      className={`backend-banner ${backend.status}`}
      onSubmit={async (event) => {
        event.preventDefault();
        await backend.login(email, password);
        setPassword("");
      }}
    >
      <span>●</span>
      <div>
        <strong>
          {backend.status === "offline"
            ? "Backend offline"
            : backend.status === "checking"
              ? "Checking backend…"
              : "Connect the business backend"}
        </strong>
        <small>
          {backend.error ||
            (backend.status === "offline"
              ? "Start the API on port 4100. Demo data remains visible."
              : "Sign in to replace demo figures with live salon data.")}
        </small>
      </div>
      <input
        type="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        aria-label="Backend account email"
        placeholder="Email"
        disabled={backend.status === "offline"}
      />
      <input
        type="password"
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-label="Backend account password"
        placeholder="Password"
        disabled={backend.status === "offline"}
      />
      <button
        type="submit"
        disabled={
          backend.status === "checking" ||
          backend.status === "offline" ||
          !password
        }
      >
        {backend.status === "checking" ? "Connecting…" : "Connect"}
      </button>
    </form>
  );
}

type ContentTab = "services" | "testimonials" | "memberships";

function WebsiteContent() {
  const [tab, setTab] = useState<ContentTab>("services");
  const [content, setContent] = useState<SiteContent | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/content", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("Content could not be loaded.");
        return response.json() as Promise<SiteContent>;
      })
      .then((data) => {
        if (active) setContent(data);
      })
      .catch((error) => {
        if (active)
          setMessage(
            error instanceof Error
              ? error.message
              : "Content could not be loaded.",
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const move = (
    section: keyof SiteContent,
    index: number,
    direction: -1 | 1,
  ) => {
    setContent((current) => {
      if (!current) return current;
      const items = [...current[section]] as Array<
        FeaturedService | Testimonial | MembershipPlan
      >;
      const target = index + direction;
      if (target < 0 || target >= items.length) return current;
      [items[index], items[target]] = [items[target], items[index]];
      return {
        ...current,
        [section]: items.map((item, displayOrder) => ({
          ...item,
          displayOrder,
        })),
      } as SiteContent;
    });
  };

  const save = async () => {
    if (!content) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/content", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(content),
      });
      const result = (await response.json()) as SiteContent & {
        error?: string;
      };
      if (!response.ok)
        throw new Error(result.error ?? "Content could not be saved.");
      setContent(result);
      setMessage("Saved. The public website now uses these updates.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Content could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  };

  if (!content)
    return (
      <div className="content-loading">
        <span />
        <p>{message || "Loading website content…"}</p>
      </div>
    );

  return (
    <div className="content-manager">
      <div className="content-overview">
        <div>
          <p className="eyebrow">Live website controls</p>
          <h2>One place to shape what customers see.</h2>
          <p>
            Order, copy and pricing saved here feed the public homepage through
            the same content API.
          </p>
        </div>
        <div className="content-live-badge">
          <span>●</span>
          <p>
            <strong>Connected</strong>
            <small>Public site · Live data</small>
          </p>
        </div>
      </div>
      <div className="content-tabs" role="tablist">
        {[
          ["services", "Popular services", "First, second, third"],
          ["testimonials", "Testimonials", "Customer stories"],
          ["memberships", "Membership plans", "Three public cards"],
        ].map(([id, label, detail]) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id as ContentTab);
              setMessage("");
            }}
          >
            <span>
              {id === "services" ? "01" : id === "testimonials" ? "02" : "03"}
            </span>
            <p>
              <strong>{label}</strong>
              <small>{detail}</small>
            </p>
          </button>
        ))}
      </div>

      {tab === "services" && (
        <section className="content-editor admin-card">
          <div className="content-editor-head">
            <div>
              <h3>Popular right now</h3>
              <p>
                The first three active services appear on the homepage in this
                exact order.
              </p>
            </div>
            <button
              onClick={() =>
                setContent((current) =>
                  current
                    ? {
                        ...current,
                        services: [
                          ...current.services,
                          {
                            id: `service-${Date.now()}`,
                            name: "New service",
                            category: "Service",
                            description:
                              "Add a short customer-facing description",
                            priceInr: 999,
                            durationMinutes: 60,
                            displayOrder: current.services.length,
                            isActive: true,
                          },
                        ],
                      }
                    : current,
                )
              }
            >
              + Add service
            </button>
          </div>
          <div className="content-service-list">
            {content.services.map((service, index) => (
              <article key={service.id}>
                <div className="content-rank">
                  <span>0{index + 1}</span>
                  <div>
                    <button
                      disabled={index === 0}
                      onClick={() => move("services", index, -1)}
                    >
                      ↑
                    </button>
                    <button
                      disabled={index === content.services.length - 1}
                      onClick={() => move("services", index, 1)}
                    >
                      ↓
                    </button>
                  </div>
                </div>
                <div className="content-fields">
                  <label>
                    Service name
                    <input
                      value={service.name}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          services: content.services.map((item) =>
                            item.id === service.id
                              ? { ...item, name: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Label
                    <input
                      value={service.category}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          services: content.services.map((item) =>
                            item.id === service.id
                              ? { ...item, category: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    Short description
                    <input
                      value={service.description}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          services: content.services.map((item) =>
                            item.id === service.id
                              ? { ...item, description: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Price (₹)
                    <input
                      type="number"
                      min="0"
                      value={service.priceInr}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          services: content.services.map((item) =>
                            item.id === service.id
                              ? {
                                  ...item,
                                  priceInr: Number(event.target.value),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Duration (minutes)
                    <input
                      type="number"
                      min="5"
                      step="5"
                      value={service.durationMinutes}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          services: content.services.map((item) =>
                            item.id === service.id
                              ? {
                                  ...item,
                                  durationMinutes: Number(event.target.value),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  className="content-remove"
                  disabled={content.services.length === 1}
                  onClick={() =>
                    setContent({
                      ...content,
                      services: content.services.filter(
                        (item) => item.id !== service.id,
                      ),
                    })
                  }
                >
                  Remove
                </button>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "testimonials" && (
        <section className="content-editor admin-card">
          <div className="content-editor-head">
            <div>
              <h3>Testimonials</h3>
              <p>
                The first three stories appear in the “Notes from the chair”
                section.
              </p>
            </div>
            <button
              onClick={() =>
                setContent({
                  ...content,
                  testimonials: [
                    ...content.testimonials,
                    {
                      id: `review-${Date.now()}`,
                      quote: "Add the customer’s experience here.",
                      customerName: "Customer name",
                      customerDetail: "Service · Visit count",
                      rating: 5,
                      displayOrder: content.testimonials.length,
                      isActive: true,
                    },
                  ],
                })
              }
            >
              + Add testimonial
            </button>
          </div>
          <div className="testimonial-editor-grid">
            {content.testimonials.map((testimonial, index) => (
              <article key={testimonial.id}>
                <header>
                  <span>0{index + 1}</span>
                  <div>
                    <button
                      disabled={index === 0}
                      onClick={() => move("testimonials", index, -1)}
                    >
                      ←
                    </button>
                    <button
                      disabled={index === content.testimonials.length - 1}
                      onClick={() => move("testimonials", index, 1)}
                    >
                      →
                    </button>
                  </div>
                </header>
                <label>
                  Customer quote
                  <textarea
                    value={testimonial.quote}
                    onChange={(event) =>
                      setContent({
                        ...content,
                        testimonials: content.testimonials.map((item) =>
                          item.id === testimonial.id
                            ? { ...item, quote: event.target.value }
                            : item,
                        ),
                      })
                    }
                  />
                </label>
                <div>
                  <label>
                    Name
                    <input
                      value={testimonial.customerName}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          testimonials: content.testimonials.map((item) =>
                            item.id === testimonial.id
                              ? { ...item, customerName: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Detail
                    <input
                      value={testimonial.customerDetail}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          testimonials: content.testimonials.map((item) =>
                            item.id === testimonial.id
                              ? { ...item, customerDetail: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <footer>
                  <label>
                    Rating
                    <select
                      value={testimonial.rating}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          testimonials: content.testimonials.map((item) =>
                            item.id === testimonial.id
                              ? { ...item, rating: Number(event.target.value) }
                              : item,
                          ),
                        })
                      }
                    >
                      {[5, 4, 3, 2, 1].map((rating) => (
                        <option value={rating} key={rating}>
                          {rating} stars
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    onClick={() =>
                      setContent({
                        ...content,
                        testimonials: content.testimonials.filter(
                          (item) => item.id !== testimonial.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      {tab === "memberships" && (
        <section className="content-editor admin-card">
          <div className="content-editor-head">
            <div>
              <h3>Membership plans</h3>
              <p>
                Three plans are shown publicly. Name, value, validity and
                benefits are all editable.
              </p>
            </div>
            <button
              disabled={content.membershipPlans.length >= 6}
              onClick={() =>
                setContent({
                  ...content,
                  membershipPlans: [
                    ...content.membershipPlans,
                    {
                      id: `plan-${Date.now()}`,
                      name: "New plan",
                      tagline: "Add a short tagline",
                      payAmount: 5000,
                      creditAmount: 7000,
                      validityMonths: 6,
                      description: "Describe who this plan is for.",
                      perks: ["Bonus salon credit"],
                      theme: "cream",
                      displayOrder: content.membershipPlans.length,
                      isFeatured: false,
                      isActive: true,
                    },
                  ],
                })
              }
            >
              + Add plan
            </button>
          </div>
          <div className="membership-editor-grid">
            {content.membershipPlans.map((plan, index) => (
              <article
                className={plan.isFeatured ? "featured" : ""}
                key={plan.id}
              >
                <header>
                  <div>
                    <span>0{index + 1}</span>
                    <p>
                      <strong>{plan.name || "Untitled plan"}</strong>
                      <small>
                        {plan.isFeatured ? "Most popular" : "Membership card"}
                      </small>
                    </p>
                  </div>
                  <div>
                    <button
                      disabled={index === 0}
                      onClick={() => move("membershipPlans", index, -1)}
                    >
                      ←
                    </button>
                    <button
                      disabled={index === content.membershipPlans.length - 1}
                      onClick={() => move("membershipPlans", index, 1)}
                    >
                      →
                    </button>
                  </div>
                </header>
                <div className="membership-editor-fields">
                  <label>
                    Plan name
                    <input
                      value={plan.name}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? { ...item, name: event.target.value }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Tagline
                    <input
                      value={plan.tagline}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? { ...item, tagline: event.target.value }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Pay amount
                    <input
                      type="number"
                      min="1"
                      value={plan.payAmount}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? {
                                    ...item,
                                    payAmount: Number(event.target.value),
                                  }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Service credit
                    <input
                      type="number"
                      min="1"
                      value={plan.creditAmount}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? {
                                    ...item,
                                    creditAmount: Number(event.target.value),
                                  }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Validity months
                    <input
                      type="number"
                      min="1"
                      value={plan.validityMonths ?? ""}
                      placeholder="No expiry"
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? {
                                    ...item,
                                    validityMonths: event.target.value
                                      ? Number(event.target.value)
                                      : null,
                                  }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Card colour
                    <select
                      value={plan.theme}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? {
                                    ...item,
                                    theme: event.target
                                      .value as MembershipPlan["theme"],
                                  }
                                : item,
                          ),
                        })
                      }
                    >
                      <option value="cream">Cream</option>
                      <option value="wine">Wine</option>
                      <option value="sage">Sage</option>
                    </select>
                  </label>
                  <label className="wide">
                    Description
                    <input
                      value={plan.description}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? { ...item, description: event.target.value }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                  <label className="wide">
                    Benefits, one per line
                    <textarea
                      value={plan.perks.join("\n")}
                      onChange={(event) =>
                        setContent({
                          ...content,
                          membershipPlans: content.membershipPlans.map(
                            (item) =>
                              item.id === plan.id
                                ? {
                                    ...item,
                                    perks: event.target.value
                                      .split("\n")
                                      .filter(Boolean),
                                  }
                                : item,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <footer>
                  <button
                    className={`featured-toggle ${plan.isFeatured ? "active" : ""}`}
                    onClick={() =>
                      setContent({
                        ...content,
                        membershipPlans: content.membershipPlans.map(
                          (item) => ({
                            ...item,
                            isFeatured: item.id === plan.id,
                          }),
                        ),
                      })
                    }
                  >
                    <i>{plan.isFeatured ? "✓" : "+"}</i>Mark most popular
                  </button>
                  <button
                    className="remove-plan"
                    disabled={content.membershipPlans.length === 1}
                    onClick={() =>
                      setContent({
                        ...content,
                        membershipPlans: content.membershipPlans.filter(
                          (item) => item.id !== plan.id,
                        ),
                      })
                    }
                  >
                    Remove
                  </button>
                </footer>
              </article>
            ))}
          </div>
        </section>
      )}

      <div className="content-savebar">
        <div>
          <span
            className={
              message.startsWith("Saved") ? "success" : message ? "error" : ""
            }
          >
            {message || "Changes stay in draft until you save."}
          </span>
          <small>Public data is stored in the salon content database.</small>
        </div>
        <Link href="/" target="_blank">
          Preview website ↗
        </Link>
        <button
          className="button admin-primary"
          disabled={saving}
          onClick={save}
        >
          {saving ? "Saving…" : "Save & publish content"}
        </button>
      </div>
    </div>
  );
}

function Dashboard({
  onView,
  data,
}: {
  onView: (view: View) => void;
  data: BackendSnapshot;
}) {
  const live = Boolean(data.today);
  const metrics = data.today
    ? [
        [
          "Today’s sales",
          money(data.today.salesMinor),
          `${data.today.bills} bills`,
          "Live from POS",
        ],
        [
          "Appointments",
          String(data.today.appointments),
          `${data.today.walkIns} walk-ins`,
          "Today",
        ],
        ["Average bill", money(data.today.avgBillMinor), "Live", "Today"],
        [
          "Low stock",
          String(data.today.lowStockCount),
          "Reorder",
          "Products at threshold",
        ],
      ]
    : [
        ["Today’s sales", "₹42,680", "+12.4%", "Up from last Sat"],
        ["Appointments", "18", "14 done", "4 remaining"],
        ["Average bill", "₹2,371", "+8.2%", "This month"],
        ["New customers", "6", "+2", "vs last Sat"],
      ];
  const dashboardAppointments = data.appointments.length
    ? data.appointments
        .slice(0, 4)
        .map((item, index) => appointmentRow(item, index))
    : appointments.slice(0, 4);
  const range = data.range;
  return (
    <div className="dashboard-view">
      <div className="metric-grid">
        {metrics.map(([label, value, badge, note], index) => (
          <article className={`metric-card metric-${index}`} key={label}>
            <div>
              <span className="metric-icon">
                {["₹", "CA", "BI", "CU"][index]}
              </span>
              <small>{label}</small>
            </div>
            <strong>{value}</strong>
            <p>
              <b>{badge}</b> {note}
            </p>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <article className="admin-card sales-card">
          <div className="card-head">
            <div>
              <h2>Sales overview</h2>
              <p>Revenue across this week</p>
            </div>
            <button>This week⌄</button>
          </div>
          <div className="sales-summary">
            <strong>₹2,48,320</strong>
            <span>↗ 14.2% vs last week</span>
          </div>
          <div className="bar-chart" aria-label="Weekly sales chart">
            {[42, 60, 52, 76, 68, 92, 58].map((height, index) => (
              <div key={index}>
                <span
                  style={{ height: `${height}%` }}
                  className={index === 5 ? "peak" : ""}
                />
                <small>
                  {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][index]}
                </small>
              </div>
            ))}
          </div>
        </article>
        <article className="admin-card audience-card">
          <div className="card-head">
            <div>
              <h2>Customer mix</h2>
              <p>Active customer segments {live && "· live"}</p>
            </div>
            <button onClick={() => onView("customers")}>View CRM →</button>
          </div>
          <div className="donut-row">
            <div className="donut">
              <span>
                <strong>{range?.customers.total ?? "1,248"}</strong>
                <small>Customers</small>
              </span>
            </div>
            <div className="donut-legend">
              <p>
                <i className="dot coral" />
                Repeat <strong>{range?.customers.repeat ?? 599}</strong>
              </p>
              <p>
                <i className="dot wine" />
                New <strong>{range?.customers.new ?? 338}</strong>
              </p>
              <p>
                <i className="dot sage" />
                At-risk{" "}
                <strong>
                  {data.customers.filter((item) =>
                    item.segments.includes("AT_RISK"),
                  ).length || 187}
                </strong>
              </p>
              <p>
                <i className="dot sand" />
                Lapsed <strong>{range?.customers.lapsed ?? 124}</strong>
              </p>
            </div>
          </div>
          <div className="followup-callout">
            <span>!</span>
            <p>
              <strong>
                {(range?.customers.lapsed ?? 124) +
                  data.customers.filter((item) =>
                    item.segments.includes("AT_RISK"),
                  ).length}{" "}
                customers need attention
              </strong>
              <br />
              At-risk or lapsed in the current CRM
            </p>
            <button onClick={() => onView("campaigns")}>Start follow-up</button>
          </div>
        </article>
      </div>
      <div className="dashboard-grid lower-grid">
        <article className="admin-card appointments-card">
          <div className="card-head">
            <div>
              <h2>Today’s appointments</h2>
              <p>
                {data.today
                  ? `${data.today.appointments} bookings · ${data.today.walkIns} walk-ins · live`
                  : "18 bookings · 2 walk-ins"}
              </p>
            </div>
            <button onClick={() => onView("calendar")}>Full calendar →</button>
          </div>
          <div className="appointment-table">
            {dashboardAppointments.map((item) => (
              <div key={`${item.time}${item.name}`}>
                <strong>{item.time}</strong>
                <span className={`customer-dot ${item.tone}`}>
                  {item.name
                    .split(" ")
                    .map((part) => part[0])
                    .join("")
                    .slice(0, 2)}
                </span>
                <span>
                  <b>{item.name}</b>
                  <small>
                    {item.service} · with {item.staff}
                  </small>
                </span>
                <em className={item.tone}>{item.status}</em>
                <button>•••</button>
              </div>
            ))}
          </div>
        </article>
        <article className="admin-card stock-card">
          <div className="card-head">
            <div>
              <h2>Needs attention</h2>
              <p>Tasks for today</p>
            </div>
            <span className="count-badge">
              {data.today?.lowStockCount ?? 4}
            </span>
          </div>
          {(
            data.products
              .filter((product) => product.stockQty <= product.reorderLevel)
              .slice(0, 4)
              .map((product) => [
                "Low stock",
                product.name,
                `${product.stockQty} units left`,
              ]) || []
          )
            .concat(
              data.products.length
                ? []
                : [
                    ["Low stock", "L’Oréal Majirel 5.0", "3 units left"],
                    ["Membership", "Aanya’s balance", "₹620 remaining"],
                    ["Payment", "Invoice #CB-1042", "UPI pending"],
                    ["Follow-up", "7 no-shows", "This month"],
                  ],
            )
            .map(([type, title, note], index) => (
              <div className="attention-row" key={title}>
                <span>{["ST", "ME", "₹", "FU"][index] ?? "ST"}</span>
                <p>
                  <small>{type}</small>
                  <strong>{title}</strong>
                  <em>{note}</em>
                </p>
                <button>→</button>
              </div>
            ))}
        </article>
      </div>
    </div>
  );
}

function Calendar({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [rescheduleId, setRescheduleId] = useState("");
  const [nextStart, setNextStart] = useState("");
  const [override, setOverride] = useState(false);
  const [promoteId, setPromoteId] = useState("");
  const [promoteStart, setPromoteStart] = useState("");
  const [promoteStaff, setPromoteStaff] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const services = new Map(
    data.categories
      .flatMap((category) => category.services)
      .map((service) => [service.id, service.name]),
  );

  const reschedule = async () => {
    const appointment = data.appointments.find(
      (item) => item.id === rescheduleId,
    );
    if (!appointment || !nextStart || !token) return;
    const originalBase = new Date(
      appointment.items[0]?.startAt ?? appointment.startAt,
    ).getTime();
    const nextBase = new Date(nextStart).getTime();
    setBusy(true);
    setMessage("");
    try {
      await backendApi.rescheduleAppointment(token, appointment.id, {
        override,
        items: appointment.items.map((item) => ({
          serviceId: item.serviceId,
          staffId: item.staffId,
          startAt: new Date(
            nextBase + (new Date(item.startAt).getTime() - originalBase),
          ).toISOString(),
        })),
      });
      setMessage(
        override
          ? "Appointment moved with a manager override; the audit event was saved."
          : "Appointment rescheduled and reminders were updated.",
      );
      setRescheduleId("");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Reschedule failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  const promote = async () => {
    if (!promoteId || !promoteStart || !promoteStaff || !token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.promoteWaitlist(token, promoteId, {
        staffId: promoteStaff,
        startAt: new Date(promoteStart).toISOString(),
      });
      setMessage("Waitlist guest promoted to a confirmed appointment.");
      setPromoteId("");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Promotion failed.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!data.appointments.length)
    return (
      <div className="calendar-view">
        <div className="calendar-toolbar">
          <div className="view-switch">
            <button className="active">Live agenda</button>
          </div>
          <button className="filter-button">No appointments yet</button>
        </div>
        <WalkInCreator token={token} data={data} onRefresh={onRefresh} />
        <div className="admin-card waitlist-empty">
          The live calendar is clear. Add a walk-in or wait for an online
          booking.
        </div>
      </div>
    );

  if (data.appointments.length)
    return (
      <div className="calendar-view">
        <div className="calendar-toolbar">
          <div className="view-switch">
            <button className="active">Live agenda</button>
          </div>
          <div>
            <button className="today-button">Appointments & waitlist</button>
          </div>
          <button className="filter-button">
            {data.appointments.length} from backend
          </button>
        </div>
        <WalkInCreator token={token} data={data} onRefresh={onRefresh} />
        {message && (
          <div
            className={`calendar-message ${message.includes("failed") || message.includes("Slot") ? "error" : ""}`}
          >
            {message}
          </div>
        )}
        <article className="admin-card live-agenda">
          <header>
            <span>Time</span>
            <span>Customer & service</span>
            <span>Artist</span>
            <span>Status</span>
            <span>Action</span>
          </header>
          {data.appointments.map((item, index) => {
            const row = appointmentRow(item, index);
            return (
              <div key={item.id}>
                <strong>{row.time}</strong>
                <span>
                  <b>{row.name}</b>
                  <small>{row.service}</small>
                </span>
                <span>{row.staff}</span>
                <em className={row.tone}>{row.status}</em>
                <button
                  onClick={() => {
                    setRescheduleId(item.id);
                    setNextStart(toDateTimeInput(item.startAt));
                    setMessage("");
                  }}
                >
                  Reschedule
                </button>
              </div>
            );
          })}
        </article>
        {rescheduleId && (
          <section className="admin-card schedule-action-panel">
            <div>
              <p className="eyebrow">Conflict-checked scheduling</p>
              <h3>Move appointment</h3>
              <small>
                Normal moves protect staff overlaps, shifts, breaks and leave.
                Manager override permits only the overlap and records an audit
                event.
              </small>
            </div>
            <label>
              New start
              <input
                type="datetime-local"
                value={nextStart}
                onChange={(event) => setNextStart(event.target.value)}
              />
            </label>
            <label className="override-check">
              <input
                type="checkbox"
                checked={override}
                onChange={(event) => setOverride(event.target.checked)}
              />
              <span>Manager override</span>
            </label>
            <button onClick={() => setRescheduleId("")}>Cancel</button>
            <button
              className="button admin-primary"
              disabled={busy || !nextStart}
              onClick={() => void reschedule()}
            >
              {busy ? "Checking…" : "Save new time"}
            </button>
          </section>
        )}
        <section className="waitlist-section">
          <div className="card-head">
            <div>
              <h2>Waitlist</h2>
              <p>
                Oldest requests first · promote only after a free slot is
                chosen.
              </p>
            </div>
            <span className="count-badge">{data.waitlist.length}</span>
          </div>
          {data.waitlist.length ? (
            <div className="waitlist-grid">
              {data.waitlist.map((entry) => (
                <article className="admin-card" key={entry.id}>
                  <div>
                    <span>WL</span>
                    <p>
                      <strong>
                        {entry.guestName ??
                          data.customers.find(
                            (customer) => customer.id === entry.customerId,
                          )?.name ??
                          "Customer"}
                      </strong>
                      <small>
                        {services.get(entry.serviceId) ?? entry.serviceId} ·
                        wants{" "}
                        {new Date(entry.desiredDate).toLocaleDateString(
                          "en-IN",
                        )}
                      </small>
                    </p>
                  </div>
                  <p>{entry.note || "No note"}</p>
                  <button
                    onClick={() => {
                      setPromoteId(entry.id);
                      setPromoteStart(toDateTimeInput(entry.desiredDate));
                      setPromoteStaff(entry.staffId ?? data.staff[0]?.id ?? "");
                      setMessage("");
                    }}
                  >
                    Promote to booking →
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <div className="admin-card waitlist-empty">
              No customers are waiting right now.
            </div>
          )}
        </section>
        {promoteId && (
          <section className="admin-card schedule-action-panel">
            <div>
              <p className="eyebrow">Waitlist promotion</p>
              <h3>Confirm the available slot</h3>
              <small>
                The backend runs the full conflict engine before creating the
                appointment.
              </small>
            </div>
            <label>
              Artist
              <select
                value={promoteStaff}
                onChange={(event) => setPromoteStaff(event.target.value)}
              >
                {data.staff.map((staff) => (
                  <option value={staff.id} key={staff.id}>
                    {staff.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start
              <input
                type="datetime-local"
                value={promoteStart}
                onChange={(event) => setPromoteStart(event.target.value)}
              />
            </label>
            <button onClick={() => setPromoteId("")}>Cancel</button>
            <button
              className="button admin-primary"
              disabled={busy || !promoteStart || !promoteStaff}
              onClick={() => void promote()}
            >
              {busy ? "Checking…" : "Confirm booking"}
            </button>
          </section>
        )}
      </div>
    );
  return (
    <div className="calendar-view">
      <div className="calendar-toolbar">
        <div className="view-switch">
          <button className="active">Day</button>
          <button>Week</button>
          <button>Month</button>
        </div>
        <div>
          <button>‹</button>
          <button className="today-button">Today</button>
          <button>›</button>
        </div>
        <button className="filter-button">Filters · All staff</button>
      </div>
      <article className="admin-card calendar-card">
        <div className="calendar-grid">
          <div className="calendar-times">
            <span />
            <span>10 AM</span>
            <span>11 AM</span>
            <span>12 PM</span>
            <span>1 PM</span>
            <span>2 PM</span>
            <span>3 PM</span>
            <span>4 PM</span>
            <span>5 PM</span>
            <span>6 PM</span>
          </div>
          {[
            ["RS", "Riya Sen"],
            ["AK", "Arjun Khanna"],
            ["MM", "Meher Malik"],
            ["PP", "Priya Pal"],
          ].map(([initials, name], col) => (
            <div className="staff-column" key={name}>
              <header>
                <span>{initials}</span>
                <strong>{name}</strong>
              </header>
              <div className="schedule-lines">
                {Array.from({ length: 9 }).map((_, i) => (
                  <i key={i} />
                ))}
              </div>
              {col === 0 && (
                <>
                  <div
                    className="calendar-event colour-event"
                    style={{ top: "12%", height: "22%" }}
                  >
                    <strong>Aanya Mehta</strong>
                    <span>Global colour · 2h</span>
                  </div>
                  <div
                    className="calendar-event spa-event"
                    style={{ top: "56%", height: "15%" }}
                  >
                    <strong>Neha Kapoor</strong>
                    <span>Hair spa · 1h 15m</span>
                  </div>
                </>
              )}
              {col === 1 && (
                <>
                  <div
                    className="calendar-event cut-event"
                    style={{ top: "27%", height: "18%" }}
                  >
                    <strong>Kabir Sethi</strong>
                    <span>Cut + beard · 1h 30m</span>
                  </div>
                  <div
                    className="calendar-event walkin-event"
                    style={{ top: "70%", height: "12%" }}
                  >
                    <strong>Walk-in</strong>
                    <span>Cut · 1h</span>
                  </div>
                </>
              )}
              {col === 2 && (
                <div
                  className="calendar-event skin-event"
                  style={{ top: "40%", height: "17%" }}
                >
                  <strong>Diya Rao</strong>
                  <span>Skin reset · 1h 15m</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </article>
    </div>
  );
}

function WalkInCreator({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const services = data.categories.flatMap((category) => category.services);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [startAt, setStartAt] = useState(() =>
    toDateTimeInput(new Date(Date.now() + 15 * 60_000).toISOString()),
  );
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const service = services.find((item) => item.id === serviceId);
  const eligible = service?.serviceStaff ?? [];

  const create = async () => {
    if (!token || !name || !phone || !serviceId || !staffId || !startAt) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createAppointment(token, {
        branchId: "main",
        guest: { name, phone },
        isWalkIn: true,
        items: [
          { serviceId, staffId, startAt: new Date(startAt).toISOString() },
        ],
      });
      setName("");
      setPhone("");
      setMessage(
        "Walk-in checked in through the conflict-safe booking engine.",
      );
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Walk-in could not be added.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="admin-card walkin-creator">
      <div>
        <p className="eyebrow">Reception quick action</p>
        <h3>Add walk-in</h3>
        <small>
          Uses the same staff-skill, shift, break, leave and conflict rules as
          online booking.
        </small>
      </div>
      <label>
        Name
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Guest name"
        />
      </label>
      <label>
        Phone
        <input
          value={phone}
          onChange={(event) => setPhone(event.target.value)}
          placeholder="Mobile number"
        />
      </label>
      <label>
        Service
        <select
          value={serviceId}
          onChange={(event) => {
            const next = event.target.value;
            setServiceId(next);
            setStaffId(
              services.find((item) => item.id === next)?.serviceStaff[0]?.staff
                .id ?? "",
            );
          }}
        >
          <option value="">Select service</option>
          {services.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Artist
        <select
          value={staffId}
          onChange={(event) => setStaffId(event.target.value)}
        >
          <option value="">Select artist</option>
          {eligible.map(({ staff }) => (
            <option key={staff.id} value={staff.id}>
              {staff.displayName}
            </option>
          ))}
        </select>
      </label>
      <label>
        Start
        <input
          type="datetime-local"
          value={startAt}
          onChange={(event) => setStartAt(event.target.value)}
        />
      </label>
      <button
        className="button admin-primary"
        disabled={busy || !token || !name || !phone || !serviceId || !staffId}
        onClick={() => void create()}
      >
        {busy ? "Checking…" : "Check in walk-in"}
      </button>
      {message && <p className="form-status">{message}</p>}
    </section>
  );
}

function POS({
  cart,
  services,
  token,
  data,
  addItem,
  removeItem,
  resetCart,
  subtotal,
  credit,
  tax,
  total,
  memberCredit,
  setMemberCredit,
  paid,
  setPaid,
}: {
  cart: CartItem[];
  services: typeof saleServices;
  token: string;
  data: BackendSnapshot;
  addItem: (item: (typeof saleServices)[number]) => void;
  removeItem: (index: number) => void;
  resetCart: () => void;
  subtotal: number;
  credit: number;
  tax: number;
  total: number;
  memberCredit: boolean;
  setMemberCredit: (value: boolean) => void;
  paid: boolean;
  setPaid: (value: boolean) => void;
}) {
  const [invoice, setInvoice] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [charging, setCharging] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerDetail, setCustomerDetail] =
    useState<BackendCustomerDetail | null>(null);
  const [membershipId, setMembershipId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "UPI" | "CARD" | "SPLIT"
  >("UPI");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const customer = data.customers.find((item) => item.id === customerId);
  const membership = customerDetail?.memberships.find(
    (item) => item.id === membershipId && item.isActive,
  );
  const redeemMinor =
    memberCredit && membership
      ? Math.min(membership.balanceMinor, total * 100)
      : 0;

  useEffect(() => {
    if (!token || !customerId) return;
    let cancelled = false;
    backendApi
      .customerDetail(token, customerId)
      .then((detail) => {
        if (cancelled) return;
        setCustomerDetail(detail);
        setMembershipId(
          detail.memberships.find(
            (item) => item.isActive && item.balanceMinor > 0,
          )?.id ?? "",
        );
      })
      .catch(() => {
        if (!cancelled) setCustomerDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, token]);

  const manualPayments = (amountMinor: number) => {
    if (amountMinor <= 0) return [];
    if (paymentMethod === "SPLIT") {
      const cash = Math.floor(amountMinor / 2);
      return [
        { method: "CASH", amountMinor: cash },
        { method: "UPI", amountMinor: amountMinor - cash },
      ];
    }
    return [{ method: paymentMethod, amountMinor }];
  };
  const charge = async () => {
    if (!token) {
      setCheckoutError("Connect the backend before completing a live bill.");
      return;
    }
    if (memberCredit && !membership) {
      setCheckoutError("Select a customer with active membership credit.");
      return;
    }
    setCharging(true);
    setCheckoutError("");
    setDeliveryMessage("");
    try {
      const payments = [
        ...(redeemMinor > 0
          ? [
              {
                method: "MEMBERSHIP_CREDIT",
                amountMinor: redeemMinor,
                membershipId,
              },
            ]
          : []),
        ...manualPayments(total * 100 - redeemMinor),
      ];
      const result = await backendApi.checkout(token, {
        branchId: "main",
        customerId: customer?.id,
        lines: cart.map((item) => ({
          kind: "service",
          serviceId: item.id,
          staffId:
            item.staffId ??
            data.staff.find((staff) => staff.displayName === item.staff)?.id,
          description: item.name,
          qty: 1,
          unitMinor: item.price * 100,
          discountMinor: 0,
          taxRateBps: 1800,
        })),
        payments,
      });
      setInvoice(result.number);
      setInvoiceId(result.id);
      setPaid(true);
      try {
        await backendApi.generateInvoicePdf(token, result.id);
        setDeliveryMessage("Branded PDF invoice ready.");
      } catch {
        setDeliveryMessage("Invoice saved; PDF can be generated again.");
      }
    } catch (cause) {
      setCheckoutError(
        cause instanceof Error ? cause.message : "Checkout failed.",
      );
    } finally {
      setCharging(false);
    }
  };
  const openInvoice = async () => {
    if (!token || !invoiceId) return;
    setCharging(true);
    setCheckoutError("");
    try {
      const url = await backendApi.invoicePdfBlob(token, invoiceId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setCheckoutError(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "PDF could not be opened.",
      );
    } finally {
      setCharging(false);
    }
  };
  const emailInvoice = async () => {
    if (!token || !invoiceId) return;
    setCharging(true);
    setCheckoutError("");
    try {
      await backendApi.sendInvoice(token, invoiceId);
      setDeliveryMessage("Invoice email queued once; retries are idempotent.");
    } catch (cause) {
      setCheckoutError(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Invoice email failed.",
      );
    } finally {
      setCharging(false);
    }
  };
  return (
    <div className="pos-layout">
      <section className="pos-catalog">
        <label className="pos-search">
          <span>⌕</span>
          <input placeholder="Search services or scan product…" />
        </label>
        <div className="pos-category-row">
          <button className="active">All</button>
          <button>Hair</button>
          <button>Colour</button>
          <button>Skin</button>
          <button>Grooming</button>
          <button>Products</button>
        </div>
        <div className="pos-service-grid">
          {services.map((service, index) => (
            <button key={service.id} onClick={() => addItem(service)}>
              <span className={`tile-icon tile-${index}`}>
                {service.name
                  .split(" ")
                  .map((word) => word[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <strong>{service.name}</strong>
              <small>{service.duration}</small>
              <b>₹{service.price.toLocaleString("en-IN")}</b>
              <i>+</i>
            </button>
          ))}
        </div>
      </section>
      <aside className="pos-cart admin-card">
        <div className="pos-customer">
          <span>
            {customer
              ? customer.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
              : "CU"}
          </span>
          <div>
            <small>Customer</small>
            <strong>{customer?.name ?? "Walk-in / guest"}</strong>
            <p>
              {customer
                ? `${customer.visitCount} visits · live CRM`
                : "Choose a customer for CRM and membership"}
            </p>
          </div>
          <select
            value={customerId}
            onChange={(event) => {
              setCustomerId(event.target.value);
              setCustomerDetail(null);
              setMembershipId("");
              setMemberCredit(false);
            }}
            aria-label="Select POS customer"
          >
            <option value="">Walk-in</option>
            {data.customers.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name} · {item.phone ?? "No phone"}
              </option>
            ))}
          </select>
        </div>
        <div className="cart-items">
          {cart.length ? (
            cart.map((item, index) => (
              <div key={`${item.id}-${index}`}>
                <span>
                  <strong>{item.name}</strong>
                  <small>with {item.staff}</small>
                </span>
                <strong>₹{item.price.toLocaleString("en-IN")}</strong>
                <button
                  onClick={() => removeItem(index)}
                  aria-label={`Remove ${item.name}`}
                >
                  ×
                </button>
              </div>
            ))
          ) : (
            <p className="empty-cart">Add a service to start the bill.</p>
          )}
        </div>
        <button
          className={`credit-toggle ${memberCredit ? "active" : ""}`}
          onClick={() => setMemberCredit(!memberCredit)}
          disabled={!customerId || !membershipId}
        >
          <span>ME</span>
          <p>
            <strong>Use membership credit</strong>
            <small>
              {membership
                ? `${money(membership.balanceMinor)} available`
                : "Choose a member customer"}
            </small>
          </p>
          <i>{memberCredit ? "✓" : "+"}</i>
        </button>
        <div className="bill-lines">
          <p>
            <span>Subtotal</span>
            <strong>₹{subtotal.toLocaleString("en-IN")}</strong>
          </p>
          {credit > 0 && (
            <p className="discount-line">
              <span>Membership credit</span>
              <strong>−₹{credit.toLocaleString("en-IN")}</strong>
            </p>
          )}
          {redeemMinor > 0 && (
            <p className="discount-line">
              <span>Membership tender</span>
              <strong>−{money(redeemMinor)}</strong>
            </p>
          )}
          <p>
            <span>GST (18%)</span>
            <strong>₹{tax.toLocaleString("en-IN")}</strong>
          </p>
          <p className="bill-total">
            <span>Total</span>
            <strong>₹{total.toLocaleString("en-IN")}</strong>
          </p>
        </div>
        {checkoutError && <p className="checkout-error">{checkoutError}</p>}
        {paid ? (
          <div className="payment-success">
            <span>✓</span>
            <p>
              <strong>Invoice and payment saved</strong>
              <small>{invoice || "Invoice ready"}</small>
            </p>
            {deliveryMessage && <small>{deliveryMessage}</small>}
            <div className="invoice-actions">
              <button disabled={charging} onClick={() => void openInvoice()}>
                Open PDF
              </button>
              <button
                disabled={charging || !customer?.email}
                onClick={() => void emailInvoice()}
              >
                Email invoice
              </button>
            </div>
            <button
              onClick={() => {
                setPaid(false);
                setInvoice("");
                setInvoiceId("");
                setDeliveryMessage("");
                resetCart();
              }}
            >
              New bill
            </button>
          </div>
        ) : (
          <>
            <div className="payment-methods">
              {(["CASH", "UPI", "CARD", "SPLIT"] as const).map((method) => (
                <button
                  key={method}
                  className={paymentMethod === method ? "active" : ""}
                  onClick={() => setPaymentMethod(method)}
                >
                  {prettyStatus(method)}
                </button>
              ))}
            </div>
            <button
              className="button pay-button"
              disabled={!cart.length || charging}
              onClick={() => void charge()}
            >
              {charging
                ? "Saving invoice…"
                : `Mark payment · ₹${total.toLocaleString("en-IN")}`}{" "}
              <span>→</span>
            </button>
          </>
        )}
      </aside>
    </div>
  );
}

function Customers({
  token,
  data,
  search,
  setSearch,
  items,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  search: string;
  setSearch: (value: string) => void;
  items: typeof customers;
  onRefresh: () => void;
}) {
  const [segment, setSegment] = useState("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [detail, setDetail] = useState<BackendCustomerDetail | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const liveRows = data.customers.filter(
    (customer) =>
      (customer.name.toLowerCase().includes(search.toLowerCase()) ||
        (customer.phone ?? "").includes(search)) &&
      (segment === "ALL" || customer.segments.includes(segment)),
  );
  const counts = Object.fromEntries(
    ["ALL", "NEW", "REPEAT", "AT_RISK", "LAPSED"].map((key) => [
      key,
      key === "ALL"
        ? data.customers.length
        : data.customers.filter((customer) => customer.segments.includes(key))
            .length,
    ]),
  );

  const create = async () => {
    if (!token || !name) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createCustomer(token, {
        branchId: "main",
        name,
        phone: phone || undefined,
        email: email || undefined,
        source: "reception",
      });
      setName("");
      setPhone("");
      setEmail("");
      setShowCreate(false);
      setMessage("Customer created and ready for booking/POS.");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Customer could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };
  const open = async (id: string) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      setDetail(await backendApi.customerDetail(token, id));
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Customer history could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customers-view">
      {message && <div className="calendar-message">{message}</div>}
      <div className="crm-toolbar">
        <label>
          <span>⌕</span>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or phone…"
          />
        </label>
        <div className="segment-tabs">
          {[
            ["ALL", "All"],
            ["NEW", "New"],
            ["REPEAT", "Repeat"],
            ["AT_RISK", "At-risk"],
            ["LAPSED", "Lapsed"],
          ].map(([key, label]) => (
            <button
              key={key}
              className={segment === key ? "active" : ""}
              onClick={() => setSegment(key)}
            >
              {label} <b>{counts[key] ?? 0}</b>
            </button>
          ))}
        </div>
        <button
          className="button admin-primary"
          onClick={() => setShowCreate((current) => !current)}
        >
          + Add customer
        </button>
      </div>
      {showCreate && (
        <section className="admin-card phase-one-form">
          <div>
            <p className="eyebrow">CRM quick create</p>
            <h3>New customer</h3>
          </div>
          <label>
            Name
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <button
            className="button admin-primary"
            disabled={busy || !token || !name}
            onClick={() => void create()}
          >
            {busy ? "Saving…" : "Create customer"}
          </button>
        </section>
      )}
      <article className="admin-card customer-table">
        <header>
          <span>Customer</span>
          <span>Segments</span>
          <span>Visits</span>
          <span>Total spend</span>
          <span>Last visit</span>
          <span />
        </header>
        {data.customers.length
          ? liveRows.map((customer) => (
              <div key={customer.id}>
                <span className="customer-cell">
                  <i>
                    {customer.name
                      .split(" ")
                      .map((part) => part[0])
                      .join("")
                      .slice(0, 2)}
                  </i>
                  <span>
                    <strong>{customer.name}</strong>
                    <small>
                      {customer.phone ?? customer.email ?? "No contact"}
                    </small>
                  </span>
                </span>
                <span className="tag-cell">
                  {customer.segments.map((tag) => (
                    <em
                      className={tag.toLowerCase().replace("_", "")}
                      key={tag}
                    >
                      {prettyStatus(tag)}
                    </em>
                  ))}
                </span>
                <span>{customer.visitCount}</span>
                <strong>{money(customer.totalSpent)}</strong>
                <span>
                  {customer.lastVisitAt
                    ? new Date(customer.lastVisitAt).toLocaleDateString(
                        "en-IN",
                        { day: "numeric", month: "short" },
                      )
                    : "No visit"}
                </span>
                <button disabled={busy} onClick={() => void open(customer.id)}>
                  →
                </button>
              </div>
            ))
          : items.map((customer) => (
              <div key={customer.name}>
                <span className="customer-cell">
                  <i>{customer.initials}</i>
                  <span>
                    <strong>{customer.name}</strong>
                    <small>{customer.phone}</small>
                  </span>
                </span>
                <span className="tag-cell">
                  {customer.tags.map((tag) => (
                    <em key={tag}>{tag}</em>
                  ))}
                </span>
                <span>{customer.visits}</span>
                <strong>{customer.spend}</strong>
                <span>{customer.last}</span>
                <button disabled>→</button>
              </div>
            ))}
      </article>
      {detail && (
        <section className="admin-card customer-360">
          <header>
            <div>
              <p className="eyebrow">Customer 360</p>
              <h2>{detail.name}</h2>
              <span>{detail.phone ?? detail.email ?? "No contact"}</span>
            </div>
            <button onClick={() => setDetail(null)}>Close</button>
          </header>
          <div className="customer-360-metrics">
            <span>
              <small>Visits</small>
              <strong>{detail.visitCount}</strong>
            </span>
            <span>
              <small>Total spend</small>
              <strong>{money(detail.totalSpent)}</strong>
            </span>
            <span>
              <small>Membership balance</small>
              <strong>
                {money(
                  detail.memberships.reduce(
                    (sum, item) => sum + item.balanceMinor,
                    0,
                  ),
                )}
              </strong>
            </span>
            <span>
              <small>Invoices</small>
              <strong>{detail.invoices.length}</strong>
            </span>
          </div>
          <div className="customer-timeline">
            <h3>Chronological timeline</h3>
            {[
              ...detail.appointments.map((appointment) => ({
                key: `a-${appointment.id}`,
                at: appointment.startAt,
                title: appointment.items
                  .map((item) => item.service.name)
                  .join(" + "),
                meta: `${prettyStatus(appointment.status)} · ${appointment.items.map((item) => item.staff.displayName).join(", ")}`,
              })),
              ...detail.invoices.map((invoice) => ({
                key: `i-${invoice.id}`,
                at: invoice.createdAt,
                title: `${invoice.number} · ${money(invoice.totalMinor)}`,
                meta: `${prettyStatus(invoice.status)} · ${invoice.payments.map((payment) => prettyStatus(payment.method)).join(" + ") || "No payment"}`,
              })),
              ...detail.memberships.flatMap((membership) =>
                membership.ledger.map((entry) => ({
                  key: `m-${entry.id}`,
                  at: entry.createdAt,
                  title: `${membership.plan.name} · ${entry.deltaMinor >= 0 ? "+" : ""}${money(entry.deltaMinor)}`,
                  meta: `${prettyStatus(entry.type)} · balance ${money(entry.balanceAfter)}`,
                })),
              ),
            ]
              .sort((a, b) => +new Date(b.at) - +new Date(a.at))
              .slice(0, 30)
              .map((event) => (
                <article key={event.key}>
                  <time>
                    {new Date(event.at).toLocaleDateString("en-IN", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    <small>{event.meta}</small>
                  </div>
                </article>
              ))}
            {!detail.appointments.length &&
              !detail.invoices.length &&
              !detail.memberships.length && (
                <p className="empty-cart">
                  No visits, invoices or membership entries yet.
                </p>
              )}
          </div>
        </section>
      )}
    </div>
  );
}

function Memberships({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const plans = data.membershipPlans;
  const [customerId, setCustomerId] = useState("");
  const [planId, setPlanId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const enroll = async () => {
    if (!token || !customerId || !planId) return;
    setBusy(true);
    setMessage("");
    try {
      const membership = await backendApi.enrollMembership(token, {
        customerId,
        planId,
      });
      setMessage(
        `Membership enrolled with ${money(membership.balanceMinor)} opening credit.`,
      );
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Membership could not be enrolled.",
      );
    } finally {
      setBusy(false);
    }
  };
  const activePlans = plans.length
    ? plans
    : [
        {
          id: "regular",
          name: "The Regular",
          payMinor: 300000,
          creditMinor: 500000,
          validityDays: 180,
          memberDiscountBps: 0,
        },
      ];
  return (
    <div>
      {message && <div className="calendar-message">{message}</div>}
      <section className="admin-card membership-enroll">
        <div>
          <p className="eyebrow">Ledger-backed enrolment</p>
          <h2>Activate membership</h2>
          <small>
            The opening credit is appended to the ledger and is never
            overwritten.
          </small>
        </div>
        <label>
          Customer
          <select
            value={customerId}
            onChange={(event) => setCustomerId(event.target.value)}
          >
            <option value="">Select customer</option>
            {data.customers.map((customer) => (
              <option value={customer.id} key={customer.id}>
                {customer.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Plan
          <select
            value={planId}
            onChange={(event) => setPlanId(event.target.value)}
          >
            <option value="">Select plan</option>
            {activePlans
              .filter((plan) =>
                data.membershipPlans.some((item) => item.id === plan.id),
              )
              .map((plan) => (
                <option value={plan.id} key={plan.id}>
                  {plan.name} · {money(plan.creditMinor)}
                </option>
              ))}
          </select>
        </label>
        <button
          className="button admin-primary"
          disabled={busy || !token || !customerId || !planId}
          onClick={() => void enroll()}
        >
          {busy ? "Activating…" : "Activate plan"}
        </button>
      </section>
      <div className="membership-metrics">
        <article>
          <span>Active plans</span>
          <strong>{activePlans.length}</strong>
          <small>{plans.length ? "Live from backend" : "Demo catalog"}</small>
        </article>
        <article>
          <span>Total plan credit</span>
          <strong>
            {money(
              activePlans.reduce((sum, plan) => sum + plan.creditMinor, 0),
            )}
          </strong>
          <small>Value available across plan catalog</small>
        </article>
        <article>
          <span>Member savings</span>
          <strong>
            {money(
              activePlans.reduce(
                (sum, plan) => sum + plan.creditMinor - plan.payMinor,
                0,
              ),
            )}
          </strong>
          <small>Combined bonus value</small>
        </article>
      </div>
      <div className="membership-plan-grid">
        {activePlans.map((plan) => (
          <article className="admin-card plan-card" key={plan.id}>
            <p className="eyebrow">Membership plan</p>
            <h2>{plan.name}</h2>
            <div className="plan-credit">
              <span>Pay</span>
              <strong>{money(plan.payMinor)}</strong>
              <i>→</i>
              <span>Get</span>
              <strong>{money(plan.creditMinor)}</strong>
            </div>
            <p>
              {plan.validityDays
                ? `Valid for ${plan.validityDays} days`
                : "No expiry"}
              {plan.memberDiscountBps
                ? ` · ${plan.memberDiscountBps / 100}% member discount`
                : ""}
            </p>
            <button className="button admin-primary">Manage plan</button>
          </article>
        ))}
      </div>
    </div>
  );
}

function Services({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState(799);
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const create = async () => {
    if (!token || !categoryId || !name || !staffIds.length) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createService(token, {
        categoryId,
        name,
        durationMin: duration,
        bufferMin: 5,
        priceMinor: price * 100,
        taxRateBps: 1800,
        staffIds,
      });
      setName("");
      setStaffIds([]);
      setMessage(
        "Service created and immediately available to eligible artists.",
      );
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Service could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="services-admin">
      {message && <div className="calendar-message">{message}</div>}
      <section className="admin-card phase-one-form service-create">
        <div>
          <p className="eyebrow">Bookable catalogue</p>
          <h2>Create service</h2>
          <small>
            Duration, tax and eligible artists feed both public booking and
            reception.
          </small>
        </div>
        <label>
          Category
          <select
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">Select category</option>
            {data.categories.map((category) => (
              <option value={category.id} key={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label>
          Duration (min)
          <input
            type="number"
            min="15"
            step="5"
            value={duration}
            onChange={(event) => setDuration(Number(event.target.value))}
          />
        </label>
        <label>
          Price (₹)
          <input
            type="number"
            min="0"
            value={price}
            onChange={(event) => setPrice(Number(event.target.value))}
          />
        </label>
        <fieldset>
          <legend>Eligible artists</legend>
          {data.staff.map((staff) => (
            <label key={staff.id}>
              <input
                type="checkbox"
                checked={staffIds.includes(staff.id)}
                onChange={(event) =>
                  setStaffIds((current) =>
                    event.target.checked
                      ? [...current, staff.id]
                      : current.filter((id) => id !== staff.id),
                  )
                }
              />
              {staff.displayName}
            </label>
          ))}
        </fieldset>
        <button
          className="button admin-primary"
          disabled={busy || !token || !categoryId || !name || !staffIds.length}
          onClick={() => void create()}
        >
          {busy ? "Creating…" : "Create service"}
        </button>
      </section>
      <div className="service-admin-grid">
        {data.categories.map((category) => (
          <article className="admin-card" key={category.id}>
            <header>
              <h3>{category.name}</h3>
              <span>{category.services.length}</span>
            </header>
            {category.services.map((service) => (
              <div key={service.id}>
                <span>
                  <strong>{service.name}</strong>
                  <small>
                    {service.durationMin} min ·{" "}
                    {service.serviceStaff
                      .map((entry) => entry.staff.displayName)
                      .join(", ") || "No artist assigned"}
                  </small>
                </span>
                <b>{money(service.priceMinor)}</b>
              </div>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}

function Inventory({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [vendorName, setVendorName] = useState("");
  const [vendorId, setVendorId] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = data.products.length
    ? data.products
    : [
        {
          id: "demo-1",
          name: "L’Oréal Majirel 5.0",
          brand: "L’Oréal",
          sku: "MAJ-50",
          stockQty: 3,
          reorderLevel: 8,
          sellMinor: 125000,
        },
        {
          id: "demo-2",
          name: "Moroccanoil Treatment",
          brand: "Moroccanoil",
          sku: "MOR-100",
          stockQty: 14,
          reorderLevel: 5,
          sellMinor: 385000,
        },
      ];
  const createVendor = async () => {
    if (!token || !vendorName) return;
    setBusy(true);
    setMessage("");
    try {
      const vendor = await backendApi.createVendor(token, { name: vendorName });
      setVendorId(vendor.id);
      setVendorName("");
      setMessage("Vendor saved.");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Vendor could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const scan = async () => {
    if (!token || !vendorId || !photoUrl) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.scanVendorBill(token, { vendorId, photoUrl });
      setPhotoUrl("");
      setMessage(
        "OCR candidate created. Review line items before confirming stock.",
      );
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? prettyStatus(cause.message) : "OCR failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (billId: string) => {
    setBusy(true);
    setMessage("");
    try {
      await backendApi.confirmPurchaseBill(token, billId);
      setMessage("Purchase confirmed and stock movements posted.");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Confirmation failed.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="inventory-view">
      <div className="membership-metrics">
        <article>
          <span>Products</span>
          <strong>{rows.length}</strong>
          <small>
            {data.products.length ? "Live stock catalog" : "Demo stock catalog"}
          </small>
        </article>
        <article>
          <span>Low stock</span>
          <strong>
            {
              rows.filter((product) => product.stockQty <= product.reorderLevel)
                .length
            }
          </strong>
          <small>At or below reorder level</small>
        </article>
        <article>
          <span>Pending vendor bills</span>
          <strong>
            {data.purchaseBills.filter((bill) => !bill.confirmedAt).length}
          </strong>
          <small>Human review required before stock</small>
        </article>
      </div>
      {message && <div className="calendar-message">{message}</div>}
      <article className="admin-card inventory-table">
        <header>
          <span>Product</span>
          <span>SKU</span>
          <span>Stock</span>
          <span>Reorder at</span>
          <span>Sell price</span>
        </header>
        {rows.map((product) => (
          <div key={product.id}>
            <span>
              <strong>{product.name}</strong>
              <small>{product.brand ?? "Unbranded"}</small>
            </span>
            <span>{product.sku ?? "—"}</span>
            <strong
              className={product.stockQty <= product.reorderLevel ? "low" : ""}
            >
              {product.stockQty}
            </strong>
            <span>{product.reorderLevel}</span>
            <span>{money(product.sellMinor)}</span>
          </div>
        ))}
      </article>
      <div className="inventory-ops-grid">
        <article className="admin-card vendor-bill-workbench">
          <div className="card-head">
            <div>
              <h2>Vendor bill AI</h2>
              <p>
                OCR creates a draft; stock changes only after review and
                confirmation.
              </p>
            </div>
          </div>
          <div className="vendor-create">
            <input
              value={vendorName}
              onChange={(event) => setVendorName(event.target.value)}
              placeholder="New vendor name"
            />
            <button
              disabled={!token || !vendorName || busy}
              onClick={() => void createVendor()}
            >
              Add vendor
            </button>
          </div>
          <label>
            Vendor
            <select
              value={vendorId}
              onChange={(event) => setVendorId(event.target.value)}
            >
              <option value="">Select vendor</option>
              {data.vendors.map((vendor) => (
                <option value={vendor.id} key={vendor.id}>
                  {vendor.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Signed bill image URL
            <input
              value={photoUrl}
              onChange={(event) => setPhotoUrl(event.target.value)}
              placeholder="https://…"
            />
          </label>
          <button
            className="button admin-primary"
            disabled={!token || !vendorId || !photoUrl || busy}
            onClick={() => void scan()}
          >
            {busy ? "Working…" : "Create OCR review draft"}
          </button>
        </article>
        <article className="admin-card purchase-bill-list">
          <div className="card-head">
            <div>
              <h2>Purchase bills</h2>
              <p>{data.purchaseBills.length} backend records</p>
            </div>
          </div>
          {data.purchaseBills.length ? (
            data.purchaseBills.slice(0, 8).map((bill) => (
              <div key={bill.id}>
                <span>
                  <strong>{bill.vendor.name}</strong>
                  <small>
                    {bill.billNumber || "Draft"} · {bill.items.length} items
                  </small>
                </span>
                <span>
                  <b>{money(bill.totalMinor)}</b>
                  <small>
                    {bill.confirmedAt
                      ? "Stock posted"
                      : `Review · ${Math.round((bill.ocrRaw?.confidence ?? 0) * 100)}% confidence`}
                  </small>
                </span>
                {!bill.confirmedAt && (
                  <button
                    disabled={!bill.items.length || busy}
                    onClick={() => void confirm(bill.id)}
                  >
                    {bill.items.length ? "Confirm stock" : "Needs review"}
                  </button>
                )}
              </div>
            ))
          ) : (
            <p className="empty-cart">No vendor bills yet.</p>
          )}
        </article>
      </div>
      <article className="admin-card movement-list">
        <div className="card-head">
          <div>
            <h2>Recent stock movements</h2>
            <p>
              Append-only purchase, sale, consumption, wastage and adjustment
              trail.
            </p>
          </div>
        </div>
        {data.inventoryMovements.slice(0, 8).map((movement) => (
          <div key={movement.id}>
            <strong>{movement.product.name}</strong>
            <span>{prettyStatus(movement.reason)}</span>
            <em className={movement.qtyDelta >= 0 ? "positive" : "negative"}>
              {movement.qtyDelta > 0 ? "+" : ""}
              {movement.qtyDelta}
            </em>
            <small>Stock {movement.stockAfter}</small>
          </div>
        ))}
        {!data.inventoryMovements.length && (
          <p className="empty-cart">No stock movements recorded yet.</p>
        )}
      </article>
    </div>
  );
}

function Inbox({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<Awaited<
    ReturnType<typeof backendApi.conversation>
  > | null>(null);
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const selected =
    data.conversations.find((item) => item.id === selectedId) ??
    data.conversations[0];
  const load = async (id: string) => {
    if (!token) return;
    setSelectedId(id);
    setBusy(true);
    setMessage("");
    try {
      setDetail(await backendApi.conversation(token, id));
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Conversation could not be loaded.",
      );
    } finally {
      setBusy(false);
    }
  };
  const send = async () => {
    if (!token || !selected || !body.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.sendConversationMessage(token, selected.id, {
        body: body.trim(),
        internal,
      });
      setBody("");
      setDetail(await backendApi.conversation(token, selected.id));
      setMessage(
        internal
          ? "Internal note saved."
          : "Reply sent through the configured provider and stored in the inbox.",
      );
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Message could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {message && <div className="calendar-message">{message}</div>}
      <div className="inbox-layout admin-card">
        <aside className="conversation-list">
          <label>
            <span>⌕</span>
            <input placeholder="Search conversations" />
          </label>
          {data.conversations.map((item) => (
            <button
              key={item.id}
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => void load(item.id)}
            >
              <span>
                {item.customer?.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2) ?? "WA"}
              </span>
              <p>
                <strong>{item.customer?.name ?? "Guest conversation"}</strong>
                <small>{prettyStatus(item.channel.type)}</small>
              </p>
              <i>
                {item.lastMessageAt
                  ? new Date(item.lastMessageAt).toLocaleTimeString("en-IN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })
                  : ""}
                {item.unread && <b>1</b>}
              </i>
            </button>
          ))}
          {!data.conversations.length && (
            <p className="empty-cart">
              No conversations yet. The provider/webhook data model is ready.
            </p>
          )}
        </aside>
        <section className="chat-panel">
          <header>
            <span>
              {selected?.customer?.name
                .split(" ")
                .map((part) => part[0])
                .join("")
                .slice(0, 2) ?? "IN"}
            </span>
            <div>
              <strong>{selected?.customer?.name ?? "Unified inbox"}</strong>
              <small>
                {selected
                  ? `${prettyStatus(selected.channel.type)} · Backend live`
                  : "Choose a conversation"}
              </small>
            </div>
          </header>
          <div className="chat-body">
            <span className="day-chip">Message history</span>
            {detail?.messages.map((item) => (
              <div
                className={`message ${item.direction === "in" ? "received" : item.direction === "internal_note" ? "note" : "sent"}`}
                key={item.id}
              >
                <p>{item.body}</p>
                <small>
                  {new Date(item.createdAt).toLocaleTimeString("en-IN", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {prettyStatus(item.status ?? item.direction)}
                </small>
              </div>
            ))}
            {selected && !detail && (
              <button
                className="button admin-primary"
                disabled={busy}
                onClick={() => void load(selected.id)}
              >
                {busy ? "Loading…" : "Open complete history"}
              </button>
            )}
          </div>
          <footer>
            <label className="internal-note-toggle">
              <input
                type="checkbox"
                checked={internal}
                onChange={(event) => setInternal(event.target.checked)}
              />
              Internal note
            </label>
            <input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                internal ? "Write a team-only note…" : "Type a reply…"
              }
            />
            <button
              disabled={busy || !selected || !body.trim()}
              onClick={() => void send()}
            >
              {busy ? "…" : "Send ↑"}
            </button>
          </footer>
        </section>
        <aside className="contact-panel">
          <div className="contact-avatar">
            {selected?.customer?.name
              .split(" ")
              .map((part) => part[0])
              .join("")
              .slice(0, 2) ?? "IN"}
          </div>
          <h3>{selected?.customer?.name ?? "No contact selected"}</h3>
          <p>{selected ? "Live CRM contact" : "Select a thread"}</p>
          <div className="contact-stats">
            <span>
              <strong>{data.conversations.length}</strong>Threads
            </span>
            <span>
              <strong>
                {data.conversations.filter((item) => item.unread).length}
              </strong>
              Unread
            </span>
          </div>
        </aside>
      </div>
    </div>
  );
}

function Campaigns({ data }: { data: BackendSnapshot }) {
  const attention = data.range
    ? data.range.customers.lapsed +
      data.customers.filter((item) => item.segments.includes("AT_RISK")).length
    : 187;
  const rows = data.campaigns.length
    ? data.campaigns.map((item) => [
        item.name,
        item.segment ? prettyStatus(item.segment) : "All customers",
        prettyStatus(item.channel),
        prettyStatus(item.status),
        String(item._count.recipients),
        new Date(item.createdAt).toLocaleDateString("en-IN"),
        "Backend",
      ])
    : [
        [
          "We miss you · August",
          "Lapsed customers",
          "WhatsApp",
          "Completed",
          "2,140",
          "86",
          "₹1.84L",
        ],
        [
          "Weekend colour ritual",
          "Repeat colour clients",
          "Email",
          "Sending",
          "820",
          "21",
          "₹54.2K",
        ],
        [
          "Birthday joy",
          "August birthdays",
          "WhatsApp",
          "Scheduled",
          "146",
          "—",
          "—",
        ],
      ];
  return (
    <div>
      <div className="campaign-banner">
        <div>
          <p className="eyebrow">Smart follow-up</p>
          <h2>{attention} customers may need a reason to return.</h2>
          <p>Campaign sending remains approval-first in the backend.</p>
        </div>
        <button className="button button-light">
          Create reactivation campaign
        </button>
      </div>
      <div className="campaign-steps">
        {[
          ["1", "Audience", `At-risk / lapsed · ${attention}`],
          ["2", "Channel", "WhatsApp, email or SMS"],
          ["3", "Content", "AI draft with human approval"],
          ["4", "Delivery", "Queued and tracked"],
        ].map(([num, label, detail], i) => (
          <article key={label} className={i < 3 ? "complete" : ""}>
            <span>{i < 3 ? "✓" : num}</span>
            <small>{label}</small>
            <strong>{detail}</strong>
          </article>
        ))}
      </div>
      <article className="admin-card campaign-table">
        <div className="card-head">
          <div>
            <h2>Recent campaigns</h2>
            <p>
              {data.campaigns.length
                ? "Live delivery records"
                : "Demo campaign records"}
            </p>
          </div>
          <button>All statuses⌄</button>
        </div>
        {rows.map((row) => (
          <div className="campaign-row" key={row[0]}>
            {row.map((cell, index) =>
              index === 0 ? (
                <strong key={cell}>{cell}</strong>
              ) : (
                <span key={`${cell}${index}`}>{cell}</span>
              ),
            )}
          </div>
        ))}
      </article>
    </div>
  );
}

function Reports({ report }: { report: BackendRangeReport | null }) {
  const repeatRate = report?.customers.total
    ? Math.round((report.customers.repeat / report.customers.total) * 100)
    : 48;
  const top: Array<[string, number]> = report?.topServices.length
    ? report.topServices
    : [
        ["Global colour", 28400000],
        ["Signature cut", 17200000],
        ["Hair spa", 11800000],
        ["Skin reset", 9600000],
      ];
  const max = Math.max(...top.map((item) => item[1]), 1);
  return (
    <div>
      <div className="report-filters">
        <button>This month</button>
        <button>All services⌄</button>
        <button>All staff⌄</button>
        <button>Export CSV/PDF</button>
      </div>
      <div className="metric-grid report-metrics">
        {[
          [
            "Gross sales",
            report ? money(report.salesMinor) : "₹9.42L",
            report ? "Live" : "+18.4%",
          ],
          [
            "Completed bills",
            String(report?.bills ?? 412),
            report ? "Live" : "+11.2%",
          ],
          [
            "Repeat customers",
            `${repeatRate}%`,
            report ? `${report?.customers.repeat ?? 0} customers` : "+3.6 pts",
          ],
          [
            "Total customers",
            String(report?.customers.total ?? 1248),
            report ? "Live CRM" : "Demo",
          ],
        ].map(([label, value, trend]) => (
          <article className="metric-card" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
            <p>
              <b>{trend}</b> · current period
            </p>
          </article>
        ))}
      </div>
      <div className="dashboard-grid">
        <article className="admin-card sales-card">
          <div className="card-head">
            <div>
              <h2>Payment mix</h2>
              <p>
                {report
                  ? "Live collected revenue"
                  : "Connect backend for payment data"}
              </p>
            </div>
          </div>
          <div className="payment-mix-list">
            {Object.entries(
              report?.paymentMix ?? {
                UPI: 42000000,
                CARD: 31000000,
                CASH: 21000000,
              },
            ).map(([method, amount]) => (
              <p key={method}>
                <span>{prettyStatus(method)}</span>
                <strong>{money(amount)}</strong>
              </p>
            ))}
          </div>
        </article>
        <article className="admin-card">
          <div className="card-head">
            <div>
              <h2>Top services</h2>
              <p>By attributed revenue</p>
            </div>
          </div>
          <div className="ranking-list">
            {top.slice(0, 5).map(([name, value], index) => (
              <div key={name}>
                <span>
                  <b>0{index + 1}</b>
                  <strong>{name}</strong>
                  <em>{money(value)}</em>
                </span>
                <i>
                  <b
                    style={{ width: `${Math.max(8, (value / max) * 100)}%` }}
                  />
                </i>
              </div>
            ))}
          </div>
        </article>
      </div>
    </div>
  );
}

function Staff({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [showCreate, setShowCreate] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const services = data.categories.flatMap((category) => category.services);
  const create = async () => {
    if (!token || !displayName) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createStaff(token, {
        branchId: "main",
        displayName,
        phone: phone || undefined,
        commissionRate: 0,
        serviceIds,
      });
      setDisplayName("");
      setPhone("");
      setServiceIds([]);
      setShowCreate(false);
      setMessage("Staff profile created with selected booking skills.");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Staff could not be created.",
      );
    } finally {
      setBusy(false);
    }
  };
  const rows = data.staff.length
    ? data.staff.map((staff) => [
        staff.displayName
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2),
        staff.displayName,
        "Salon artist",
        `${data.categories.flatMap((category) => category.services).filter((service) => service.serviceStaff.some((link) => link.staff.id === staff.id)).length} services`,
        money(data.range?.topStaff.find(([id]) => id === staff.id)?.[1] ?? 0),
      ])
    : [
        ["RS", "Riya Sen", "Creative colourist", "6 services", "₹1.82L"],
        ["AK", "Arjun Khanna", "Style director", "8 services", "₹1.64L"],
        ["MM", "Meher Malik", "Skin therapist", "5 services", "₹1.09L"],
        ["PP", "Priya Pal", "Nail artist", "4 services", "₹76K"],
      ];
  return (
    <div className="staff-view">
      {message && <div className="calendar-message">{message}</div>}
      <button
        className="button admin-primary staff-create-trigger"
        onClick={() => setShowCreate((current) => !current)}
      >
        + Add staff
      </button>
      {showCreate && (
        <section className="admin-card phase-one-form">
          <div>
            <p className="eyebrow">Team setup</p>
            <h2>New staff profile</h2>
          </div>
          <label>
            Name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>
            Phone
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <fieldset>
            <legend>Bookable skills</legend>
            {services.map((service) => (
              <label key={service.id}>
                <input
                  type="checkbox"
                  checked={serviceIds.includes(service.id)}
                  onChange={(event) =>
                    setServiceIds((current) =>
                      event.target.checked
                        ? [...current, service.id]
                        : current.filter((id) => id !== service.id),
                    )
                  }
                />
                {service.name}
              </label>
            ))}
          </fieldset>
          <button
            className="button admin-primary"
            disabled={busy || !token || !displayName}
            onClick={() => void create()}
          >
            {busy ? "Saving…" : "Create staff"}
          </button>
        </section>
      )}
      <div className="staff-grid">
        {rows.map(([initials, name, role, skills, sales], index) => (
          <article className="admin-card staff-card" key={name}>
            <span className={`staff-photo photo-${index}`}>{initials}</span>
            <h3>{name}</h3>
            <p>{role}</p>
            <div>
              <span>
                <small>Skills</small>
                <strong>{skills}</strong>
              </span>
              <span>
                <small>Month sales</small>
                <strong>{sales}</strong>
              </span>
            </div>
            <button>View profile →</button>
          </article>
        ))}
      </div>
    </div>
  );
}

function Attendance({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [mode, setMode] = useState<"check-in" | "check-out">("check-in");
  const [selfie, setSelfie] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const record = async () => {
    if (!token || !staffId || !selfie || !consent) return;
    setBusy(true);
    setMessage("");
    try {
      const position = await new Promise<GeolocationPosition>(
        (resolve, reject) =>
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 15_000,
          }),
      );
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () =>
          resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = reject;
        reader.readAsDataURL(selfie);
      });
      const upload = await backendApi.uploadMedia(token, {
        purpose: "attendance-selfie",
        contentType: selfie.type,
        base64,
        consent: true,
      });
      const result = await backendApi.attendance(token, mode, {
        staffId,
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        selfieKey: upload.key,
        consent: true,
      });
      setMessage(
        `${mode === "check-in" ? "Check-in" : "Check-out"} saved inside the ${Math.round(result.distanceMeters ?? 0)}m geofence.`,
      );
      setSelfie(null);
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Attendance could not be recorded.",
      );
    } finally {
      setBusy(false);
    }
  };
  const rows = data.attendance.length
    ? data.attendance.map((item) => {
        const minutes =
          item.checkInAt && item.checkOutAt
            ? Math.round(
                (new Date(item.checkOutAt).getTime() -
                  new Date(item.checkInAt).getTime()) /
                  60_000,
              )
            : 0;
        return [
          item.staff.displayName
            .split(" ")
            .map((part) => part[0])
            .join("")
            .slice(0, 2),
          item.staff.displayName,
          item.checkInAt
            ? new Date(item.checkInAt).toLocaleTimeString("en-IN", {
                hour: "2-digit",
                minute: "2-digit",
              })
            : "—",
          item.checkOutAt
            ? `${Math.floor(minutes / 60)}h ${minutes % 60}m`
            : "Open",
          item.lateMinutes > 0 ? "Late" : "Present",
        ];
      })
    : [
        ["RS", "Riya Sen", "09:46 AM", "8h 14m", "Present"],
        ["AK", "Arjun Khanna", "09:52 AM", "8h 08m", "Present"],
        ["MM", "Meher Malik", "10:03 AM", "7h 57m", "Present"],
        ["PP", "Priya Pal", "10:14 AM", "7h 46m", "Late"],
      ];
  return (
    <div className="attendance-view">
      {message && <div className="calendar-message">{message}</div>}
      <section className="admin-card attendance-capture">
        <div>
          <p className="eyebrow">Consent & geofence protected</p>
          <h2>Record attendance</h2>
          <p>
            Location and selfie are stored only after explicit staff consent and
            every action is audited.
          </p>
        </div>
        <label>
          Staff
          <select
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          >
            <option value="">Select staff</option>
            {data.staff.map((staff) => (
              <option value={staff.id} key={staff.id}>
                {staff.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select
            value={mode}
            onChange={(event) =>
              setMode(event.target.value as "check-in" | "check-out")
            }
          >
            <option value="check-in">Check in</option>
            <option value="check-out">Check out</option>
          </select>
        </label>
        <label>
          Live selfie
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => setSelfie(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="consent-box">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>Staff consent confirmed</span>
        </label>
        <button
          className="button admin-primary"
          disabled={!token || !staffId || !selfie || !consent || busy}
          onClick={() => void record()}
        >
          {busy ? "Verifying…" : "Verify & record"}
        </button>
      </section>
      <article className="admin-card attendance-card">
        <div className="card-head">
          <div>
            <h2>This month’s attendance</h2>
            <p>
              {data.attendance.length
                ? "Live, audited records"
                : "Demo records until the first check-in"}
            </p>
          </div>
          <button>Attendance policy</button>
        </div>
        {rows.map((row) => (
          <div className="attendance-row" key={`${row[1]}${row[2]}`}>
            <span>{row[0]}</span>
            <strong>{row[1]}</strong>
            <small>
              Check-in <b>{row[2]}</b>
            </small>
            <small>
              Hours <b>{row[3]}</b>
            </small>
            <em className={row[4].toLowerCase().replace(" ", "")}>{row[4]}</em>
            <button>•••</button>
          </div>
        ))}
      </article>
    </div>
  );
}

function Payroll({ data }: { data: BackendSnapshot }) {
  const totalCommission = data.payroll.reduce(
    (sum, row) => sum + row.commissionMinor,
    0,
  );
  return (
    <div className="payroll-view">
      <div className="membership-metrics">
        <article>
          <span>Staff in payroll</span>
          <strong>{data.payroll.length}</strong>
          <small>Current month</small>
        </article>
        <article>
          <span>Service revenue</span>
          <strong>
            {money(
              data.payroll.reduce(
                (sum, row) => sum + row.serviceRevenueMinor,
                0,
              ),
            )}
          </strong>
          <small>Attributed invoice lines</small>
        </article>
        <article>
          <span>Estimated commission</span>
          <strong>{money(totalCommission)}</strong>
          <small>Basis-point rules per staff profile</small>
        </article>
      </div>
      <article className="admin-card payroll-table">
        <header>
          <span>Staff</span>
          <span>Present days</span>
          <span>Worked</span>
          <span>Late</span>
          <span>Service revenue</span>
          <span>Commission</span>
        </header>
        {data.payroll.map((row) => (
          <div key={row.staffId}>
            <strong>{row.displayName}</strong>
            <span>{row.presentDays}</span>
            <span>
              {Math.floor(row.workedMinutes / 60)}h {row.workedMinutes % 60}m
            </span>
            <span>{row.lateMinutes}m</span>
            <span>{money(row.serviceRevenueMinor)}</span>
            <strong>
              {money(row.commissionMinor)}{" "}
              <small>({row.commissionRateBps / 100}%)</small>
            </strong>
          </div>
        ))}
        {!data.payroll.length && (
          <p className="empty-cart">
            Connect the backend to calculate payroll from attendance and invoice
            data.
          </p>
        )}
      </article>
    </div>
  );
}

function Settings() {
  return (
    <div className="settings-layout">
      <aside>
        {[
          "Business profile",
          "Booking rules",
          "Notifications",
          "Payments & tax",
          "Roles & permissions",
          "Integrations",
          "Data & backups",
        ].map((item, index) => (
          <button className={index === 1 ? "active" : ""} key={item}>
            {item}
            <span>→</span>
          </button>
        ))}
      </aside>
      <article className="admin-card settings-card">
        <p className="eyebrow">Booking rules</p>
        <h2>Availability & scheduling</h2>
        <div className="setting-row">
          <div>
            <strong>Booking interval</strong>
            <small>Start times shown to customers</small>
          </div>
          <select defaultValue="30">
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Minimum notice</strong>
            <small>Prevent last-minute online bookings</small>
          </div>
          <select defaultValue="2">
            <option value="1">1 hour</option>
            <option value="2">2 hours</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Allow waitlist</strong>
            <small>Offer a waitlist when a day is full</small>
          </div>
          <button className="toggle active">
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Manager conflict override</strong>
            <small>Require a reason and keep an audit entry</small>
          </div>
          <button className="toggle active">
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Cancellation window</strong>
            <small>Free reschedule before this point</small>
          </div>
          <select defaultValue="3">
            <option value="3">3 hours</option>
            <option value="6">6 hours</option>
          </select>
        </div>
        <button className="button admin-primary">Save changes</button>
      </article>
    </div>
  );
}
