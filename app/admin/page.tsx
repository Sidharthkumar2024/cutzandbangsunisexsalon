"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import BrandLogo from "../components/BrandLogo";
import type {
  FeaturedService,
  MembershipPlan,
  SiteContent,
  Testimonial,
} from "../../lib/content-types";
import { useBackendIntegration } from "../../lib/use-backend-integration";
import {
  backendApi,
  type CashBreakdown,
  type BackendAppointment,
  type BackendCampaignCtaButton,
  type BackendCustomer,
  type BackendCustomerDetail,
  type BackendCategory,
  type BackendInvoiceArchive,
  type BackendInvoiceArchiveItem,
  type BackendPlan,
  type BackendProviderConfig,
  type BackendRangeReport,
  type BackendService,
  type BackendSnapshot,
  type BackendSubscription,
  type BackendTenant,
  type BackendTenantDomain,
  type BackendWhatsAppTemplate,
  type BackendWhatsAppStatus,
} from "../../lib/backend-api";

type View =
  | "dashboard"
  | "calendar"
  | "pos"
  | "customers"
  | "memberships"
  | "services"
  | "inventory"
  | "cash"
  | "invoices"
  | "inbox"
  | "content"
  | "coupons"
  | "campaigns"
  | "reports"
  | "staff"
  | "attendance"
  | "payroll"
  | "saas"
  | "system"
  | "settings";
type CartItem = {
  id: string;
  kind: "service" | "product";
  serviceId?: string;
  productId?: string;
  name: string;
  staff: string;
  staffId?: string;
  companionId?: string;
  price: number;
  taxRateBps: number;
};
type InvoiceWhatsAppChannel =
  | "WHATSAPP_OFFICIAL"
  | "WHATSAPP_UNOFFICIAL";
type SaleService = {
  id: string;
  name: string;
  duration: string;
  price: number;
};
type CustomerDirectorySegment = "ALL" | "NEW" | "REPEAT" | "AT_RISK" | "LAPSED";

const money = (minor: number) =>
  `₹${Math.round(minor / 100).toLocaleString("en-IN")}`;

const CUSTOMER_DIRECTORY_PAGE_SIZE = 100;

const initialsFor = (name?: string | null) =>
  (name ?? "WA")
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase() || "WA";

const categoryDisplayName = (category: BackendCategory) =>
  category.parent ? `${category.parent.name} › ${category.name}` : category.name;

const categoryGroupName = (category: BackendCategory) =>
  category.parent?.name ?? category.name;

const buildRateListMessage = (catalog: BackendCategory[], customerName?: string) => {
  const servicesAvailable = catalog
    .map((category) => ({
      ...category,
      services: [...category.services]
        .filter((service) => service.isActive)
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .filter((category) => category.services.length > 0)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const heading = [
    "*CUTZ & BANGS UNISEX SALON*",
    customerName ? `Hi ${customerName}, here is our latest service rate list.` : "Here is our latest service rate list.",
    "",
    "Location: First Floor, Plot No. 118, Main Kakrola Rd, Patel Garden, Sector 15 Dwarka, New Delhi",
    "Timings: 10:00 AM onwards",
    "",
  ];

  if (!servicesAvailable.length) {
    return [...heading, "No active services found right now. Please contact salon reception to confirm availability."].join("\n");
  }

  const grouped = servicesAvailable.reduce<Record<string, BackendCategory[]>>((acc, category) => {
    const key = categoryGroupName(category);
    acc[key] = [...(acc[key] ?? []), category];
    return acc;
  }, {});

  const categoryLines = Object.entries(grouped).flatMap(([group, categories]) => [
    `*${group}*`,
    ...categories.flatMap((category) => [
      category.parent ? `_${category.name}${category.gender ? ` · ${category.gender}` : ""}_` : "",
      ...category.services.map((service) => `${service.name} — ${money(service.priceMinor)}`),
    ]).filter(Boolean),
    "",
  ]);

  return [...heading, ...categoryLines, "Reply *BOOK* with your preferred service to confirm."].join("\n");
};
const CASH_DENOMINATIONS = [
  { value: 1, kind: "Coin" },
  { value: 2, kind: "Coin" },
  { value: 5, kind: "Coin" },
  { value: 10, kind: "Note / coin" },
  { value: 20, kind: "Note" },
  { value: 50, kind: "Note" },
  { value: 100, kind: "Note" },
  { value: 200, kind: "Note" },
  { value: 500, kind: "Note" },
] as const;
const emptyCashBreakdown = (): CashBreakdown => Object.fromEntries(CASH_DENOMINATIONS.map(({ value }) => [String(value), 0]));
const cashBreakdownTotalMinor = (breakdown: CashBreakdown) => CASH_DENOMINATIONS.reduce((sum, item) => sum + item.value * Math.max(0, breakdown[String(item.value)] ?? 0) * 100, 0);

function CashDenominationCounter({ value, onChange, expectedMinor, title = "Count physical cash" }: { value: CashBreakdown; onChange: (next: CashBreakdown) => void; expectedMinor?: number; title?: string }) {
  const total = cashBreakdownTotalMinor(value);
  const matches = expectedMinor === undefined || total === expectedMinor;
  return (
    <div className="cash-denomination-counter">
      <header><div><strong>{title}</strong><small>Enter how many coins or notes are physically in the drawer.</small></div><span className={matches ? "matches" : "mismatch"}>{expectedMinor === undefined ? "Counted" : matches ? "Matched" : "Mismatch"}<b>{money(total)}</b></span></header>
      <div className="cash-denomination-grid">
        {CASH_DENOMINATIONS.map((item) => <label key={item.value}><span><strong>₹{item.value}</strong><small>{item.kind}</small></span><input aria-label={`Number of ₹${item.value} ${item.kind.toLowerCase()}s`} type="number" min="0" step="1" value={value[String(item.value)] || ""} placeholder="0" onChange={(event) => onChange({ ...value, [String(item.value)]: Math.max(0, Math.floor(Number(event.target.value) || 0)) })} /></label>)}
      </div>
      {expectedMinor !== undefined && <p className={matches ? "cash-match-message" : "cash-mismatch-message"}>{matches ? `✓ Physical count exactly matches expected drawer cash (${money(expectedMinor)}).` : `Counted ${money(total)} · expected ${money(expectedMinor)} · fix the count or record the missing expense before closing.`}</p>}
    </div>
  );
}
const prettyStatus = (value: string) =>
  value
    .toLowerCase()
    .split("_")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
const dataStaffName = (data: BackendSnapshot, staffId: string) =>
  data.staff.find((staff) => staff.id === staffId)?.displayName ?? "Retail";
const toDateTimeInput = (value: string) => {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
};
const localDateKey = (value: Date | string) => {
  const date = typeof value === "string" ? new Date(value) : value;
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
};
const shiftDateKey = (value: string, days: number) => {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + days);
  return localDateKey(date);
};
const dateRangeIso = (fromKey: string, toKey: string) => ({
  from: new Date(`${fromKey}T00:00:00`).toISOString(),
  to: new Date(`${shiftDateKey(toKey, 1)}T00:00:00`).toISOString(),
});
const parseCsv = (text: string) => {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') { cell += '"'; index += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell.trim()); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
};
type CampaignManualContact = {
  name: string;
  phone: string;
  email?: string;
  waConsent: boolean;
  emailConsent: boolean;
  consentSource: string;
};
type CampaignCtaDraft = BackendCampaignCtaButton & { id: string };
const newCampaignCta = (): CampaignCtaDraft => ({
  id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  type: "WEBSITE",
  label: "Book now",
  value: "",
});
const campaignCtaHint = (type: BackendCampaignCtaButton["type"]) => {
  if (type === "CALL") return "Phone number, e.g. 9876543210";
  if (type === "LOCATION") return "Google Maps link or salon address";
  return "Website URL, e.g. https://cutzandbangs.com";
};
const sanitizeCampaignCtas = (buttons: CampaignCtaDraft[]): BackendCampaignCtaButton[] =>
  buttons
    .map((button) => ({
      type: button.type,
      label: button.label.trim(),
      value: button.value.trim(),
      ...(button.secondary?.trim() ? { secondary: button.secondary.trim() } : {}),
    }))
    .filter((button) => button.label.length >= 2 && button.value.length >= 3)
    .slice(0, 3);
const normalizeCampaignPhone = (value: string) => {
  const digits = value.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91") && /^[6-9]\d{9}$/.test(digits.slice(2))) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
};
const extractCampaignPhones = (text: string) =>
  Array.from(text.matchAll(/[+]?\d[\d\s().-]{6,}\d/g))
    .map((match) => normalizeCampaignPhone(match[0]))
    .filter(Boolean);
const campaignAudienceStats = (phones: string[]) => {
  const seen = new Set<string>();
  let invalid = 0;
  let duplicates = 0;
  for (const phone of phones) {
    if (phone.length < 8 || phone.length > 15) {
      invalid += 1;
      continue;
    }
    if (seen.has(phone)) {
      duplicates += 1;
      continue;
    }
    seen.add(phone);
  }
  return { total: phones.length, valid: seen.size, invalid, duplicates, uniquePhones: [...seen] };
};
const dedupeCampaignContacts = (contacts: CampaignManualContact[]) => {
  const unique = new Map<string, CampaignManualContact>();
  for (const contact of contacts) {
    const phone = normalizeCampaignPhone(contact.phone);
    if (phone.length < 8 || phone.length > 15 || unique.has(phone)) continue;
    unique.set(phone, { ...contact, phone });
  }
  return [...unique.values()];
};
const csvContactsForCampaign = (rows: string[][], whatsappConsent = false): CampaignManualContact[] => {
  if (!rows.length) throw new Error("CSV did not contain any rows.");
  const headers = rows[0].map((header) => header.toLowerCase().replace(/[^a-z]/g, ""));
  const column = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const nameAt = column("name", "fullname", "customername");
  const phoneAt = column("phone", "mobile", "whatsapp", "whatsappnumber", "number", "mobilenumber");
  const emailAt = column("email", "emailaddress");
  const waConsentAt = column("waconsent", "whatsappconsent", "optin", "whatsappoptin");
  const emailConsentAt = column("emailconsent", "emailoptin");
  const consentSourceAt = column("consentsource", "optinsource");
  const hasHeader = [nameAt, phoneAt, emailAt, waConsentAt, emailConsentAt, consentSourceAt].some((index) => index >= 0);
  const yes = (value = "") => /^(1|true|yes|y|opted\s*in|consented)$/i.test(value.trim());
  const dataRows = hasHeader ? rows.slice(1) : rows;
  return dataRows.flatMap((values) => {
    const rawPhone = phoneAt >= 0 ? (values[phoneAt] ?? "") : values.join(" ");
    const phones = extractCampaignPhones(rawPhone);
    const inferredName = values.find((value, index) =>
      index !== phoneAt &&
      index !== emailAt &&
      value &&
      !extractCampaignPhones(value).length &&
      !value.includes("@") &&
      /[A-Za-z]/.test(value),
    );
    return phones.map((phone, index) => ({
      name: nameAt >= 0 && values[nameAt] ? values[nameAt] : inferredName || `Guest ${phone.slice(-4)}`,
      phone,
      ...(emailAt >= 0 && values[emailAt] ? { email: values[emailAt] } : {}),
      waConsent: whatsappConsent || (waConsentAt >= 0 && yes(values[waConsentAt])),
      emailConsent: emailConsentAt >= 0 && yes(values[emailConsentAt]),
      consentSource: consentSourceAt >= 0 && values[consentSourceAt] ? values[consentSourceAt] : index ? "CSV extra phone column" : "Campaign audience import",
    }));
  }).filter((row) => row.phone);
};
const campaignContactsFromText = (text: string, whatsappConsent = false) => {
  const rows = parseCsv(text);
  if (rows.length) return csvContactsForCampaign(rows, whatsappConsent);
  return extractCampaignPhones(text).map((phone) => ({
    name: `Guest ${phone.slice(-4)}`,
    phone,
    waConsent: whatsappConsent,
    emailConsent: false,
    consentSource: "Pasted campaign audience",
  }));
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
      { id: "memberships", label: "Memberships & packages", icon: "ME" },
      { id: "inbox", label: "Inbox", icon: "IN" },
    ],
  },
  {
    label: "Operations",
    items: [
      { id: "services", label: "Services", icon: "SV" },
      { id: "inventory", label: "Inventory", icon: "IV" },
      { id: "cash", label: "Cash & expenses", icon: "₹" },
      { id: "invoices", label: "Invoices", icon: "IN" },
    ],
  },
  {
    label: "Growth",
    items: [
      { id: "content", label: "Website content", icon: "WC" },
      { id: "coupons", label: "Coupons", icon: "CO" },
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
      { id: "system", label: "System & audit", icon: "SY" },
    ],
  },
  {
    label: "Platform",
    items: [{ id: "saas", label: "SaaS platform", icon: "SA" }],
  },
];

const viewPermission: Partial<Record<View, string>> = {
  dashboard: "dashboard", calendar: "calendar", pos: "pos", customers: "customers", memberships: "memberships",
  inbox: "inbox", services: "services", inventory: "inventory", cash: "cash", invoices: "pos", content: "website", coupons: "coupons",
  campaigns: "campaigns", reports: "reports", staff: "staff", attendance: "staff", payroll: "payroll", system: "audit", settings: "settings",
};

const viewTitles: Record<View, [string, string]> = {
  dashboard: ["Salon dashboard", "Here’s how Cutz & Bangs is doing today."],
  calendar: [
    "Booking calendar",
    "Live appointments, walk-ins and artist schedules.",
  ],
  pos: ["Point of sale", "Build, mark and issue a bill in a few taps."],
  customers: ["Customers", "One clear history across every booking and visit."],
  memberships: ["Memberships & packages", "Create plans, build service bundles, assign them and track every redemption."],
  services: [
    "Service catalogue",
    "Create bookable services and connect eligible artists.",
  ],
  inventory: [
    "Inventory",
    "Products, vendor bills, stock movements and reorder alerts.",
  ],
  cash: ["Cash & expenses", "Opening float, daily expenses and end-of-day reconciliation."],
  invoices: ["Invoice archive", "Search, download and deliver every stored salon invoice."],
  inbox: ["Unified inbox", "WhatsApp, email and internal notes in one queue."],
  content: [
    "Website content",
    "Manage what customers see on the public website.",
  ],
  coupons: ["Coupons", "Create percentage or fixed offers with controlled usage."],
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
  saas: [
    "SaaS platform",
    "Create salons, assign plans, connect domains and prepare multi-branch rollout.",
  ],
  system: [
    "System health & audit",
    "Service checks, security posture and an immutable change history.",
  ],
  settings: ["Settings", "Business, booking, loyalty and notification rules."],
};

export default function AdminPage() {
  const [view, setView] = useState<View>("dashboard");
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [posCustomerId, setPosCustomerId] = useState("");
  const [headerCustomerSearchOpen, setHeaderCustomerSearchOpen] = useState(false);
  const [headerCustomerMatches, setHeaderCustomerMatches] = useState<BackendCustomer[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [memberCredit, setMemberCredit] = useState(false);
  const [paid, setPaid] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [notificationOpen, setNotificationOpen] = useState(false);
  const backend = useBackendIntegration();
  const unreadNotifications = backend.data.notifications.filter((item) => !item.readAt);
  const unreadConversations = backend.data.conversations.filter((item) => item.unread).length;
  const liveServices = backend.data.categories
    .flatMap((category) => category.services)
    .map((service) => ({
      id: service.id,
      name: service.name,
      duration: `${service.durationMin}m`,
      price: service.priceMinor / 100,
    }));
  const pointOfSaleServices = liveServices;
  const subtotal = cart.reduce((sum, item) => sum + item.price, 0);
  // Membership credit is an auditable payment tender, not a discount. Cutz & Bangs
  // POS bills are tax-free, so payable total is the service/product subtotal.
  const credit = 0;
  const tax = 0;
  const total = subtotal;
  const activeBranch = backend.data.branches.find((branch) => branch.id === (backend.data.user?.branchId ?? "main")) ?? backend.data.branches[0];
  const role = backend.data.user?.role;
  const headerCustomerQuery = customerSearchQuery.trim();
  useEffect(() => {
    if (view !== "pos" || !backend.token || !headerCustomerQuery) {
      setHeaderCustomerMatches([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      backendApi
        .customerDirectory(backend.token, { q: headerCustomerQuery, take: 8 })
        .then((result) => {
          if (!cancelled) setHeaderCustomerMatches(result.customers);
        })
        .catch(() => {
          if (!cancelled) setHeaderCustomerMatches([]);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [backend.token, headerCustomerQuery, view]);
  const adminRoles = new Set(["SUPERADMIN", "OWNER", "ADMIN", "MANAGER", "RECEPTION"]);
  if (backend.status !== "connected" || !backend.data.user) {
    return <AdminAccessGate status={backend.status} error={backend.error} />;
  }
  if (!adminRoles.has(backend.data.user.role)) {
    return <AdminAccessGate status="forbidden" error="This account does not have admin workspace access." onLogout={backend.logout} />;
  }
  const allowedViews = new Set<View>(
    role === "SUPERADMIN"
      ? ["saas", "settings"]
      : role === "RECEPTION"
      ? ["dashboard", "calendar", "pos", "customers", "memberships", "inbox", "cash", "invoices"]
      : role === "MANAGER"
        ? ["dashboard", "calendar", "pos", "customers", "memberships", "services", "inventory", "cash", "invoices", "inbox", "coupons", "campaigns", "reports", "staff", "attendance", "payroll", "settings"]
        : role === "STAFF"
          ? ["calendar", "customers"]
          : navGroups.flatMap((group) => group.items.map((item) => item.id)).concat("settings"),
  );
  const granularPermissions = backend.data.user.permissionKeys ?? [];
  if (granularPermissions.length && role !== "OWNER") {
    for (const allowedView of [...allowedViews]) {
      const permission = viewPermission[allowedView];
      if (permission && !granularPermissions.includes(permission)) allowedViews.delete(allowedView);
    }
  }
  const activeView = allowedViews.has(view) ? view : ([...allowedViews][0] ?? "dashboard");
  const [title, subtitle] = viewTitles[activeView];

  const selectView = (next: View) => {
    setView(next);
    setMobileNav(false);
    setHeaderCustomerSearchOpen(false);
    setPaid(false);
  };
  const selectHeaderPosCustomer = (customer: BackendSnapshot["customers"][number]) => {
    setPosCustomerId(customer.id);
    setCustomerSearchQuery(customer.phone ?? customer.name);
    setHeaderCustomerSearchOpen(false);
  };
  const addItem = (item: SaleService) => {
    const backendService = backend.data.categories
      .flatMap((category) => category.services)
      .find((service) => service.id === item.id);
    const staff =
      backendService?.serviceStaff[0]?.staff.displayName ?? "Unassigned";
    setCart((current) => [
      ...current,
      {
        id: item.id,
        kind: "service",
        serviceId: item.id,
        name: item.name,
        staff,
        staffId: backendService?.serviceStaff[0]?.staff.id,
        price: item.price,
        taxRateBps: backendService?.taxRateBps ?? 1800,
      },
    ]);
  };
  const addProduct = (product: BackendSnapshot["products"][number]) => {
    setCart((current) => [
      ...current,
      {
        id: product.id,
        kind: "product",
        productId: product.id,
        name: product.name,
        staff: "Retail",
        price: product.sellMinor / 100,
        taxRateBps: product.taxRateBps,
      },
    ]);
  };

  return (
    <main className="admin-shell">
      {mobileNav && <button className="mobile-nav-backdrop" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
      <aside className={`admin-sidebar ${mobileNav ? "open" : ""}`}>
        <div className="admin-brand">
          <Link className="wordmark" href="/">
            <BrandLogo priority />
          </Link>
          <button className="mobile-close" onClick={() => setMobileNav(false)}>
            ×
          </button>
        </div>
        <TenantBranchSwitcher
          token={backend.token}
          activeTenantId={backend.data.user.activeTenantId}
          activeBranchId={activeBranch?.id ?? backend.data.user.branchId}
          fallbackBranchName={activeBranch?.name ?? "Sector 15 Dwarka"}
          onRefresh={() => void backend.refresh()}
        />
        <nav aria-label="Admin navigation">
          {navGroups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.filter((item) => !role || allowedViews.has(item.id)).map((item) => (
                <button
                  key={item.id}
                  className={activeView === item.id ? "active" : ""}
                  onClick={() => selectView(item.id)}
                >
                  <span>{item.icon}</span>
                  {item.label}
                  {item.id === "inbox" && unreadConversations > 0 && <b>{unreadConversations}</b>}
                </button>
              ))}
            </div>
          ))}
        </nav>
        {allowedViews.has("settings") && <button
          className={`sidebar-settings ${activeView === "settings" ? "active" : ""}`}
          onClick={() => selectView("settings")}
        >
          <span>SE</span>Settings
        </button>}
        <div className="admin-user">
          <span>SS</span>
          <div>
            <strong>{backend.data.user?.email?.split("@")[0] ?? "Salon team"}</strong>
            <small>{backend.data.user?.role ? prettyStatus(backend.data.user.role) : "Signed out"}</small>
          </div>
          {backend.token ? <button onClick={backend.logout}>Log out</button> : <i>•••</i>}
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
            <div className="global-search-control">
              <label className="global-search admin-search-field">
                <span>⌕</span>
                <input
                  value={customerSearchQuery}
                  onFocus={() => view === "pos" && setHeaderCustomerSearchOpen(true)}
                  onBlur={() => window.setTimeout(() => setHeaderCustomerSearchOpen(false), 150)}
                  onInput={(event) => {
                    setCustomerSearchQuery(event.currentTarget.value);
                    if (view === "pos") setHeaderCustomerSearchOpen(true);
                  }}
                  onChange={(event) => {
                    setCustomerSearchQuery(event.target.value);
                    if (view === "pos") setHeaderCustomerSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setHeaderCustomerSearchOpen(false);
                      return;
                    }
                    if (event.key !== "Enter" || !customerSearchQuery.trim()) return;
                    if (view === "pos") {
                      if (headerCustomerMatches[0]) selectHeaderPosCustomer(headerCustomerMatches[0]);
                      return;
                    }
                    selectView("customers");
                  }}
                  placeholder={
                    view === "pos"
                      ? "Find POS customer by name or phone…"
                      : "Search customers by name or phone…"
                  }
                  role={view === "pos" ? "combobox" : undefined}
                  aria-autocomplete={view === "pos" ? "list" : undefined}
                  aria-expanded={view === "pos" ? headerCustomerSearchOpen && Boolean(headerCustomerQuery) : undefined}
                  aria-controls={view === "pos" ? "header-pos-customer-results" : undefined}
                />
              </label>
              {view === "pos" && headerCustomerSearchOpen && headerCustomerQuery && (
                <div
                  id="header-pos-customer-results"
                  className="global-customer-results"
                  role="listbox"
                  aria-label="POS matching customers"
                >
                  {headerCustomerMatches.map((customer) => (
                    <button
                      type="button"
                      role="option"
                      aria-selected={customer.id === posCustomerId}
                      key={customer.id}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectHeaderPosCustomer(customer)}
                    >
                      <span>{initialsFor(customer.name)}</span>
                      <span><strong>{customer.name}</strong><small>{customer.phone ?? "No phone number"}</small></span>
                      <small>{customer.visitCount} visits</small>
                    </button>
                  ))}
                  {!headerCustomerMatches.length && (
                    <button
                      type="button"
                      className="global-customer-empty"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setHeaderCustomerSearchOpen(false);
                        document.getElementById("pos-customer-search")?.focus();
                        document.getElementById("pos-quick-customer-form")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                      }}
                    >
                      No match · add this customer in POS
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="notification-control">
              <button
                className="icon-button"
                aria-label="Notifications"
                aria-expanded={notificationOpen}
                onClick={() => setNotificationOpen((current) => !current)}
              >
                ●{unreadNotifications.length > 0 && <b>{unreadNotifications.length}</b>}
              </button>
              {notificationOpen && (
                <div className="notification-popover">
                  <header><strong>Notifications</strong><small>{unreadNotifications.length} unread</small></header>
                  {backend.data.notifications.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      className={item.readAt ? "read" : ""}
                      onClick={async () => {
                        if (!item.readAt && backend.token) await backendApi.markNotificationRead(backend.token, item.id).catch(() => undefined);
                        setNotificationOpen(false);
                        selectView(item.title.toLowerCase().includes("reschedule") ? "calendar" : "system");
                        await backend.refresh();
                      }}
                    >
                      <strong>{item.title}</strong>
                      <small>{item.body ?? new Date(item.createdAt).toLocaleString("en-IN")}</small>
                    </button>
                  ))}
                  {!backend.data.notifications.length && <p>No new notifications.</p>}
                </div>
              )}
            </div>
            <div className="admin-session-actions">
              <span><strong>{prettyStatus(backend.data.user.role)}</strong><small>{backend.data.user.email}</small></span>
              <button onClick={backend.logout}>Log out</button>
            </div>
            {allowedViews.has("pos") && <button
              className="button admin-primary"
              onClick={() => selectView(activeView === "pos" ? "calendar" : "pos")}
            >
              {activeView === "pos" ? "+ New booking" : "+ New sale"}
            </button>}
          </div>
        </header>
        <div className="admin-page">
          <BackendConnection backend={backend} />
          {activeView === "dashboard" && (
            <Dashboard token={backend.token} onView={selectView} data={backend.data} />
          )}
          {activeView === "calendar" && (
            <Calendar
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "pos" && (
            <POS
              cart={cart}
              services={pointOfSaleServices}
              token={backend.token}
              data={backend.data}
              addItem={addItem}
              addProduct={addProduct}
              assignStaff={(index, staffId) => setCart((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, staffId, staff: dataStaffName(backend.data, staffId) } : item))}
              assignCompanion={(index, companionId) => setCart((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, companionId: companionId || undefined } : item))}
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
              customerId={posCustomerId}
              onCustomerIdChange={setPosCustomerId}
              headerCustomerSearch={customerSearchQuery}
              onHeaderCustomerSearchChange={setCustomerSearchQuery}
              onRefresh={() => void backend.refresh()}
              onOpenCashbook={() => selectView("cash")}
            />
          )}
          {activeView === "customers" && (
            <Customers
              token={backend.token}
              data={backend.data}
              customerSearchQuery={customerSearchQuery}
              setCustomerSearchQuery={setCustomerSearchQuery}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "memberships" && (
            <Memberships
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "services" && (
            <Services
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "inventory" && (
            <Inventory
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "cash" && (
            <Cashbook token={backend.token} data={backend.data} onRefresh={() => void backend.refresh()} />
          )}
          {activeView === "invoices" && (
            <Invoices token={backend.token} data={backend.data} onRefresh={() => void backend.refresh()} />
          )}
          {activeView === "inbox" && (
            <Inbox
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "content" && <WebsiteContent token={backend.token} />}
          {activeView === "coupons" && (
            <Coupons
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "campaigns" && (
            <Campaigns
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "reports" && <Reports token={backend.token} data={backend.data} />}
          {activeView === "staff" && (
            <Staff
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "attendance" && (
            <Attendance
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
          {activeView === "payroll" && <Payroll data={backend.data} />}
          {activeView === "saas" && <SaasPlatform token={backend.token} />}
          {activeView === "system" && (
            <SystemAndAudit
              token={backend.token}
              data={backend.data}
            />
          )}
          {activeView === "settings" && (
            <Settings
              token={backend.token}
              data={backend.data}
              onRefresh={() => void backend.refresh()}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function TenantBranchSwitcher({
  token,
  activeTenantId,
  activeBranchId,
  fallbackBranchName,
  onRefresh,
}: {
  token: string;
  activeTenantId?: string | null;
  activeBranchId?: string | null;
  fallbackBranchName: string;
  onRefresh: () => void;
}) {
  const [tenants, setTenants] = useState<BackendTenant[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (!token) return undefined;
    setLoading(true);
    backendApi.tenants(token)
      .then((nextTenants) => {
        if (active) setTenants(nextTenants);
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Salons could not be loaded.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token]);

  const options = tenants.flatMap((tenant) =>
    (tenant.branches?.length ? tenant.branches : [{ id: tenant.membershipBranchId ?? "", name: tenant.name, timezone: tenant.timezone, currency: tenant.currency }])
      .filter((branch) => Boolean(branch.id))
      .map((branch) => ({
        value: `${tenant.id}:${branch.id}`,
        tenantId: tenant.id,
        branchId: branch.id,
        label: tenants.length > 1 ? `${tenant.name} — ${branch.name}` : branch.name,
        status: tenant.status,
      })),
  );
  const selectedValue = options.find((option) => option.tenantId === activeTenantId && option.branchId === activeBranchId)?.value ?? options[0]?.value ?? "";

  const switchBranch = async (value: string) => {
    const option = options.find((item) => item.value === value);
    if (!option) return;
    setLoading(true);
    setMessage("");
    try {
      await backendApi.switchTenant(token, { tenantId: option.tenantId, branchId: option.branchId });
      onRefresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Branch could not be switched.");
    } finally {
      setLoading(false);
    }
  };

  if (options.length <= 1) {
    return (
      <div className="branch-chip">
        <span>C&B</span>
        <div>
          <strong>{options[0]?.label ?? fallbackBranchName}</strong>
          <small>{loading ? "Loading…" : message || "Active workspace"}</small>
        </div>
        <i>⌄</i>
      </div>
    );
  }

  return (
    <label className="branch-chip branch-switcher">
      <span>C&B</span>
      <div>
        <strong>Workspace</strong>
        <select
          value={selectedValue}
          disabled={loading}
          onChange={(event) => void switchBranch(event.target.value)}
          aria-label="Switch salon branch"
        >
          {options.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label} · {prettyStatus(option.status)}
            </option>
          ))}
        </select>
        {message && <small>{message}</small>}
      </div>
      <i>⌄</i>
    </label>
  );
}

type SaasTenantDraft = {
  name: string;
  slug: string;
  ownerEmail: string;
  branchName: string;
  planSlug: string;
  primaryDomain: string;
};

function SaasPlatform({ token }: { token: string }) {
  const [plans, setPlans] = useState<BackendPlan[]>([]);
  const [tenants, setTenants] = useState<BackendTenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [subscription, setSubscription] = useState<BackendSubscription | null>(null);
  const [domains, setDomains] = useState<BackendTenantDomain[]>([]);
  const [draft, setDraft] = useState<SaasTenantDraft>({
    name: "",
    slug: "",
    ownerEmail: "",
    branchName: "Main branch",
    planSlug: "starter",
    primaryDomain: "",
  });
  const [domainHost, setDomainHost] = useState("");
  const [subscriptionPlanId, setSubscriptionPlanId] = useState("");
  const [subscriptionStatus, setSubscriptionStatus] = useState("ACTIVE");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const selectedTenant = tenants.find((tenant) => tenant.id === selectedTenantId) ?? tenants[0];

  const loadPlatform = async () => {
    if (!token) return;
    const [nextPlans, nextTenants] = await Promise.all([
      backendApi.plans(),
      backendApi.tenants(token),
    ]);
    setPlans(nextPlans);
    setTenants(nextTenants);
    if (!selectedTenantId && nextTenants[0]) setSelectedTenantId(nextTenants[0].id);
    if (!draft.planSlug && nextPlans[0]) setDraft((current) => ({ ...current, planSlug: nextPlans[0].slug }));
  };

  useEffect(() => {
    let active = true;
    setMessage("");
    Promise.all([backendApi.plans(), backendApi.tenants(token)])
      .then(([nextPlans, nextTenants]) => {
        if (!active) return;
        setPlans(nextPlans);
        setTenants(nextTenants);
        setSelectedTenantId((current) => current || nextTenants[0]?.id || "");
        setDraft((current) => ({ ...current, planSlug: current.planSlug || nextPlans[0]?.slug || "starter" }));
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "SaaS platform could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !selectedTenantId) {
      setSubscription(null);
      setDomains([]);
      return;
    }
    let active = true;
    Promise.all([
      backendApi.tenantSubscription(token, selectedTenantId),
      backendApi.tenantDomains(token, selectedTenantId),
    ])
      .then(([nextSubscription, nextDomains]) => {
        if (!active) return;
        setSubscription(nextSubscription);
        setDomains(nextDomains);
        setSubscriptionPlanId(nextSubscription?.planId ?? plans[0]?.id ?? "");
        setSubscriptionStatus(nextSubscription?.status ?? "ACTIVE");
      })
      .catch((error) => {
        if (active) setMessage(error instanceof Error ? error.message : "Tenant details could not be loaded.");
      });
    return () => {
      active = false;
    };
  }, [plans, selectedTenantId, token]);

  const createTenant = async () => {
    if (!draft.name.trim()) {
      setMessage("Salon name is required.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const tenant = await backendApi.createTenant(token, {
        name: draft.name.trim(),
        slug: draft.slug.trim() || undefined,
        ownerEmail: draft.ownerEmail.trim() || undefined,
        planSlug: draft.planSlug,
        branchName: draft.branchName.trim() || "Main branch",
        primaryDomain: draft.primaryDomain.trim() || undefined,
      });
      setSelectedTenantId(tenant.id);
      setDraft({ name: "", slug: "", ownerEmail: "", branchName: "Main branch", planSlug: draft.planSlug, primaryDomain: "" });
      await loadPlatform();
      setMessage(`${tenant.name} created. Owner can now be invited from staff/team access.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tenant could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const updateTenantStatus = async (tenant: BackendTenant, status: string) => {
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateTenant(token, tenant.id, { status });
      await loadPlatform();
      setMessage(`${tenant.name} marked ${prettyStatus(status)}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Tenant status could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const saveSubscription = async () => {
    if (!selectedTenant || !subscriptionPlanId) {
      setMessage("Select a salon and plan first.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const next = await backendApi.setTenantSubscription(token, selectedTenant.id, {
        planId: subscriptionPlanId,
        status: subscriptionStatus,
        interval: subscription?.interval ?? "MONTHLY",
      });
      setSubscription(next);
      await loadPlatform();
      setMessage(`Subscription updated for ${selectedTenant.name}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Subscription could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const addDomain = async () => {
    if (!selectedTenant || !domainHost.trim()) {
      setMessage("Enter a domain for the selected salon.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createTenantDomain(token, selectedTenant.id, domainHost.trim());
      setDomainHost("");
      setDomains(await backendApi.tenantDomains(token, selectedTenant.id));
      await loadPlatform();
      setMessage(`Domain added for ${selectedTenant.name}. Point DNS A/CNAME to the app server, then verify.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Domain could not be added.");
    } finally {
      setBusy(false);
    }
  };

  const stats = [
    ["Salons", tenants.length],
    ["Active", tenants.filter((tenant) => tenant.status === "ACTIVE").length],
    ["Plans", plans.filter((plan) => plan.isActive).length],
    ["Domains", tenants.reduce((sum, tenant) => sum + (tenant.primaryDomain ? 1 : 0), 0) + domains.length],
  ];

  return (
    <div className="saas-platform-view">
      {message && <div className="backend-banner"><span>●</span><div><strong>Platform update</strong><small>{message}</small></div><button onClick={() => setMessage("")}>Dismiss</button></div>}
      <section className="saas-kpis">
        {stats.map(([label, value]) => (
          <article className="admin-card" key={label}>
            <small>{label}</small>
            <strong>{value}</strong>
          </article>
        ))}
      </section>

      <section className="admin-card phase-one-form saas-create-form">
        <div>
          <p className="eyebrow">New salon tenant</p>
          <h2>Create a salon workspace</h2>
          <p>Every salon gets isolated data, its own branches, plan and custom domain mapping.</p>
        </div>
        <label>
          Salon name
          <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="Example: Glow Studio" />
        </label>
        <label>
          Slug
          <input value={draft.slug} onChange={(event) => setDraft({ ...draft, slug: event.target.value })} placeholder="glow-studio" />
        </label>
        <label>
          Owner email
          <input value={draft.ownerEmail} onChange={(event) => setDraft({ ...draft, ownerEmail: event.target.value })} placeholder="owner@example.com" type="email" />
        </label>
        <label>
          Branch name
          <input value={draft.branchName} onChange={(event) => setDraft({ ...draft, branchName: event.target.value })} placeholder="Main branch" />
        </label>
        <label>
          Primary domain
          <input value={draft.primaryDomain} onChange={(event) => setDraft({ ...draft, primaryDomain: event.target.value })} placeholder="salon.example.com" />
        </label>
        <label>
          Plan
          <select value={draft.planSlug} onChange={(event) => setDraft({ ...draft, planSlug: event.target.value })}>
            {plans.map((plan) => <option value={plan.slug} key={plan.id}>{plan.name} · {money(plan.monthlyPriceMinor)}/mo</option>)}
          </select>
        </label>
        <button className="button admin-primary" disabled={busy} onClick={() => void createTenant()}>
          {busy ? "Working…" : "Create salon"}
        </button>
      </section>

      <div className="saas-management-grid">
        <section className="admin-card saas-tenant-list">
          <div className="card-head"><div><h2>Salon tenants</h2><p>Select a salon to manage subscription and domains.</p></div><button onClick={() => void loadPlatform()}>Refresh</button></div>
          {tenants.map((tenant) => (
            <button
              key={tenant.id}
              className={selectedTenant?.id === tenant.id ? "active" : ""}
              onClick={() => setSelectedTenantId(tenant.id)}
            >
              <span><strong>{tenant.name}</strong><small>{tenant.slug} · {tenant.branches?.length ?? 0} branches · {tenant.plan?.name ?? "No plan"}</small></span>
              <b className={`tenant-status ${tenant.status.toLowerCase()}`}>{prettyStatus(tenant.status)}</b>
            </button>
          ))}
          {!tenants.length && <p className="empty-cart">No salon tenants created yet.</p>}
        </section>

        <section className="admin-card saas-tenant-detail">
          <div className="card-head">
            <div>
              <h2>{selectedTenant?.name ?? "Select salon"}</h2>
              <p>{selectedTenant ? `${selectedTenant.slug} · ${selectedTenant.timezone} · ${selectedTenant.currency}` : "Choose a tenant from the list."}</p>
            </div>
            {selectedTenant && (
              <div className="customer-360-actions">
                <button disabled={busy || selectedTenant.status === "ACTIVE"} onClick={() => void updateTenantStatus(selectedTenant, "ACTIVE")}>Activate</button>
                <button disabled={busy || selectedTenant.status === "SUSPENDED"} onClick={() => void updateTenantStatus(selectedTenant, "SUSPENDED")}>Suspend</button>
              </div>
            )}
          </div>

          {selectedTenant && (
            <>
              <div className="saas-detail-panels">
                <label>
                  Subscription plan
                  <select value={subscriptionPlanId} onChange={(event) => setSubscriptionPlanId(event.target.value)}>
                    {plans.map((plan) => <option value={plan.id} key={plan.id}>{plan.name}</option>)}
                  </select>
                </label>
                <label>
                  Status
                  <select value={subscriptionStatus} onChange={(event) => setSubscriptionStatus(event.target.value)}>
                    <option value="TRIALING">Trialing</option>
                    <option value="ACTIVE">Active</option>
                    <option value="PAST_DUE">Past due</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </label>
                <button disabled={busy} onClick={() => void saveSubscription()}>Save subscription</button>
              </div>

              <div className="saas-domain-panel">
                <label>
                  Add custom domain
                  <input value={domainHost} onChange={(event) => setDomainHost(event.target.value)} placeholder="salon.example.com" />
                </label>
                <button disabled={busy} onClick={() => void addDomain()}>Add domain</button>
              </div>

              <div className="saas-domain-list">
                {(domains.length ? domains : selectedTenant.primaryDomain ? [{ id: selectedTenant.primaryDomain, hostname: selectedTenant.primaryDomain, status: "PENDING", tenantId: selectedTenant.id }] : []).map((domain) => (
                  <span key={domain.id}>
                    <strong>{domain.hostname}</strong>
                    <small>{prettyStatus(domain.status)}</small>
                  </span>
                ))}
                {!domains.length && !selectedTenant.primaryDomain && <p>No domains connected yet.</p>}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function BackendConnection({
  backend,
}: {
  backend: ReturnType<typeof useBackendIntegration>;
}) {
  return (
    <div className="backend-banner connected">
      <span>●</span>
      <div>
        <strong>Signed in securely</strong>
        <small>{prettyStatus(backend.data.user?.role ?? "team")} access · live salon data · HttpOnly session</small>
      </div>
      <button onClick={() => void backend.refresh()}>Refresh</button>
      <button onClick={backend.logout}>Log out</button>
    </div>
  );
}

function AdminAccessGate({
  status,
  error,
  onLogout,
}: {
  status: "checking" | "offline" | "ready" | "connected" | "forbidden";
  error?: string;
  onLogout?: () => void;
}) {
  const checking = status === "checking";
  const offline = status === "offline";
  return (
    <main className="portal-auth-shell admin-access-gate">
      <Link className="wordmark brand-image-link" href="/"><BrandLogo priority /></Link>
      <section className="portal-auth-card">
        <p className="eyebrow">Protected admin workspace</p>
        <h1>{checking ? <>Checking your<br /><em>secure session.</em></> : offline ? <>Backend is<br /><em>not reachable.</em></> : status === "forbidden" ? <>Access is<br /><em>not authorised.</em></> : <>Team login<br /><em>required.</em></>}</h1>
        <p>{error ? readableAdminError(error) : checking ? "Verifying the encrypted session before any salon data is rendered." : offline ? "The operations API must be online before the admin workspace can open. No demo or customer data is exposed." : "Sign in with an owner, admin, manager or reception account. Google Authenticator verification is enforced when enabled."}</p>
        {!checking && status !== "forbidden" && <Link className="button admin-primary" href="/admin/login">Open secure login</Link>}
        {status === "forbidden" && <button className="button admin-primary" onClick={onLogout}>Sign out & use another account</button>}
        <Link className="auth-mode-link" href="/">Return to public website</Link>
      </section>
    </main>
  );
}

function readableAdminError(value: string) {
  const map: Record<string, string> = {
    unauthenticated: "Your secure session has ended. Sign in again to continue.",
    backend_not_configured: "The production backend URL has not been connected yet.",
    backend_unavailable: "The secure backend is temporarily unavailable.",
  };
  return map[value] ?? value.replaceAll("_", " ");
}

type ContentTab = "services" | "testimonials" | "memberships";

function WebsiteContent({ token }: { token: string }) {
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
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
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
          disabled={saving || !token}
          onClick={save}
        >
          {saving ? "Saving…" : "Save & publish content"}
        </button>
      </div>
    </div>
  );
}

function Dashboard({
  token,
  onView,
  data,
}: {
  token: string;
  onView: (view: View) => void;
  data: BackendSnapshot;
}) {
  const todayKey = localDateKey(new Date());
  const monthStartKey = `${todayKey.slice(0, 7)}-01`;
  const [fromDate, setFromDate] = useState(monthStartKey);
  const [toDate, setToDate] = useState(todayKey);
  const [rangeInsights, setRangeInsights] = useState<NonNullable<BackendSnapshot["dashboardInsights"]> | null>(null);
  const [rangeLoading, setRangeLoading] = useState(false);
  const [rangeMessage, setRangeMessage] = useState("");
  const live = Boolean(data.today);
  const insights = rangeInsights ?? data.dashboardInsights;
  const selectedRange = rangeInsights?.selectedRange;

  const applyDashboardRange = async (nextFrom = fromDate, nextTo = toDate) => {
    if (!token || !nextFrom || !nextTo || nextFrom > nextTo) return;
    setRangeLoading(true);
    setRangeMessage("");
    try {
      const result = await backendApi.dashboardReport(token, nextFrom, nextTo);
      setRangeInsights(result);
      setRangeMessage(`Showing ${new Date(`${nextFrom}T12:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" })} to ${new Date(`${nextTo}T12:00:00`).toLocaleDateString("en-IN", { dateStyle: "medium" })}.`);
    } catch (cause) {
      setRangeMessage(cause instanceof Error ? prettyStatus(cause.message) : "Dashboard history could not be loaded.");
    } finally {
      setRangeLoading(false);
    }
  };

  const metrics = selectedRange
    ? [
        ["Selected sales", money(selectedRange.salesMinor), `${selectedRange.bills} bills`, `${selectedRange.days} day range`],
        ["Appointments", String(selectedRange.appointments), `${selectedRange.walkIns} walk-ins`, "Selected range"],
        ["Average bill", money(selectedRange.tickets.averageMinor), `${selectedRange.completedAppointments} completed`, "Selected range"],
        ["New customers", String(selectedRange.newCustomers), "Added in range", "From live CRM"],
      ]
    : data.today
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
          "New customers",
          String(data.today.newCustomers),
          "Added today",
          "From live CRM",
        ],
      ]
    : [
        ["Today’s sales", money(0), "No bills", "Waiting for live POS data"],
        ["Appointments", "0", "No bookings", "Waiting for live calendar data"],
        ["Average bill", money(0), "No bills", "Waiting for live POS data"],
        ["New customers", "0", "No records", "Waiting for live CRM data"],
      ];
  const dashboardAppointments = data.appointments
    .slice(0, 4)
    .map((item, index) => appointmentRow(item, index));
  const range = data.range;
  const chartRows = insights?.dailySales ?? [];
  const chartMax = Math.max(1, ...chartRows.map((row) => row.salesMinor));
  return (
    <div className="dashboard-view">
      <form
        className="dashboard-range-toolbar"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const nextFrom = String(form.get("from") ?? fromDate);
          const nextTo = String(form.get("to") ?? toDate);
          setFromDate(nextFrom);
          setToDate(nextTo);
          void applyDashboardRange(nextFrom, nextTo);
        }}
      >
        <div>
          <p className="eyebrow">Historical dashboard</p>
          <strong>Choose any date range</strong>
          <small>{rangeMessage || "Compare past sales, bills, appointments and customers without changing today’s live data."}</small>
        </div>
        <label><span>From</span><input name="from" type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label>
        <label><span>To</span><input name="to" type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label>
        <button className="button admin-primary" type="submit" disabled={rangeLoading || !token || !fromDate || !toDate || fromDate > toDate}>{rangeLoading ? "Loading…" : "Apply"}</button>
        <button className="button" type="button" disabled={rangeLoading || !token} onClick={() => { setFromDate(monthStartKey); setToDate(todayKey); void applyDashboardRange(monthStartKey, todayKey); }}>This month</button>
        {rangeInsights && <button className="button" type="button" onClick={() => { setRangeInsights(null); setRangeMessage(""); }}>Live default</button>}
      </form>
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
      {insights && (
        <div className="insight-strip">
          <span><small>Minimum ticket · {selectedRange ? "selected range" : "month"}</small><strong>{money(selectedRange?.tickets.minimumMinor ?? insights.tickets.minimumMinor)}</strong></span>
          <span><small>Maximum ticket · {selectedRange ? "selected range" : "month"}</small><strong>{money(selectedRange?.tickets.maximumMinor ?? insights.tickets.maximumMinor)}</strong></span>
          <span><small>Best sales day · {selectedRange ? "selected range" : "month"}</small><strong>{money(selectedRange?.maxDaily.salesMinor ?? insights.sales.maxDaily.salesMinor)}</strong><em>{new Date(`${selectedRange?.maxDaily.date ?? insights.sales.maxDaily.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</em></span>
          <span><small>Not returned in {insights.thresholds.inactiveDays}+ days</small><strong>{insights.customers.inactive}</strong><em>{insights.customers.neverVisited} never visited</em></span>
        </div>
      )}
      <div className="dashboard-grid">
        <article className="admin-card sales-card">
          <div className="card-head">
            <div>
              <h2>Sales overview</h2>
              <p>{selectedRange ? `Daily sales · ${selectedRange.from} to ${selectedRange.to}` : insights ? "Daily sales · rolling 15 days" : "Revenue across this week"}</p>
            </div>
            <span className="filter-button">{selectedRange ? `${selectedRange.days} days` : insights ? "Last 15 days" : "This week"}</span>
          </div>
          <div className="sales-summary">
            <strong>{money(selectedRange?.salesMinor ?? insights?.sales.rolling15Minor ?? 0)}</strong>
            <span>{selectedRange ? `${money(selectedRange.collectedMinor)} collected · ${money(selectedRange.historicalSalesMinor)} imported history` : insights ? `${money(insights.sales.rolling10Minor)} in last 10 days` : "No live sales data yet"}</span>
          </div>
          <div className={`bar-chart ${chartRows.length ? "rolling-chart" : ""}`} aria-label="Rolling 15-day sales chart">
            {chartRows.map((row) => {
              const height = Math.max(3, Math.round((row.salesMinor / chartMax) * 100));
              const label = new Date(`${row.date}T12:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
              return <div key={row.date} title={`${label}: ${money(row.salesMinor)} · ${row.bills} bills`}>
                <span
                  style={{ height: `${height}%` }}
                  className={height === Math.max(...chartRows.map((item) => Math.max(3, Math.round((item.salesMinor / chartMax) * 100)))) ? "peak" : ""}
                />
                <small>{label}</small>
              </div>;
            })}
            {!chartRows.length && <p className="empty-cart">Sales will appear here after the first live bill.</p>}
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
                <strong>{range?.customers.total ?? 0}</strong>
                <small>Customers</small>
              </span>
            </div>
            <div className="donut-legend">
              <p>
                <i className="dot coral" />
                Repeat <strong>{range?.customers.repeat ?? 0}</strong>
              </p>
              <p>
                <i className="dot wine" />
                New <strong>{range?.customers.new ?? 0}</strong>
              </p>
              <p>
                <i className="dot sage" />
                At-risk{" "}
                <strong>
                  {data.customers.filter((item) =>
                    item.segments.includes("AT_RISK"),
                  ).length}
                </strong>
              </p>
              <p>
                <i className="dot sand" />
                Lapsed <strong>{range?.customers.lapsed ?? 0}</strong>
              </p>
            </div>
          </div>
          <div className="followup-callout">
            <span>!</span>
            <p>
              <strong>
                {(range?.customers.lapsed ?? 0) +
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
                  : "No live booking data yet"}
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
                <button aria-label={`Open ${item.name}'s appointment`} onClick={() => onView("calendar")}>Open</button>
              </div>
            ))}
            {!dashboardAppointments.length && <p className="empty-cart">No appointments scheduled for today.</p>}
          </div>
        </article>
        <article className="admin-card stock-card">
          <div className="card-head">
            <div>
              <h2>Needs attention</h2>
              <p>Tasks for today</p>
            </div>
            <span className="count-badge">
              {data.today?.lowStockCount ?? 0}
            </span>
          </div>
          {data.products
            .filter((product) => product.stockQty <= product.reorderLevel)
            .slice(0, 4)
            .map((product) => [
              "Low stock",
              product.name,
              `${product.stockQty} units left`,
            ])
            .map(([type, title, note], index) => (
              <div className="attention-row" key={title}>
                <span>{["ST", "ME", "₹", "FU"][index] ?? "ST"}</span>
                <p>
                  <small>{type}</small>
                  <strong>{title}</strong>
                  <em>{note}</em>
                </p>
                <button
                  aria-label={`Open ${title}`}
                  onClick={() => onView(type === "Low stock" ? "inventory" : type === "Follow-up" ? "campaigns" : type === "Membership" ? "memberships" : "reports")}
                >
                  →
                </button>
              </div>
            ))}
          {!data.products.some((product) => product.stockQty <= product.reorderLevel) && (
            <p className="empty-cart">No operational alerts right now.</p>
          )}
        </article>
      </div>
      {insights && (
        <article className="admin-card inactive-customers-card">
          <div className="card-head">
            <div>
              <h2>Customers who are not returning</h2>
              <p>{insights.customers.inactive} customers have not visited for at least {insights.thresholds.inactiveDays} days.</p>
            </div>
            <button onClick={() => onView("campaigns")}>Create follow-up campaign →</button>
          </div>
          <div className="inactive-customer-table">
            <header><span>Customer</span><span>Contact</span><span>Last visit</span><span>Visits</span><span>Lifetime spend</span><span>Loyalty</span></header>
            {insights.customers.inactiveList.slice(0, 12).map((customer) => (
              <div key={customer.id}>
                <strong>{customer.name}</strong>
                <span>{customer.phone || customer.email || "No contact"}</span>
                <span>{customer.lastVisitAt ? `${customer.daysSinceVisit} days ago` : "Never"}</span>
                <span>{customer.visitCount}</span>
                <span>{money(customer.totalSpent)}</span>
                <span>{customer.loyaltyPoints} pts</span>
              </div>
            ))}
            {!insights.customers.inactiveList.length && <p className="empty-cart">No inactive customers at this threshold.</p>}
          </div>
        </article>
      )}
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
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [rangeStart, setRangeStart] = useState(() => localDateKey(new Date()));
  const [rangeEnd, setRangeEnd] = useState(() => localDateKey(new Date()));
  const [rangeActive, setRangeActive] = useState(false);
  const [calendarAppointments, setCalendarAppointments] = useState<BackendAppointment[]>(data.appointments);
  const [calendarLoading, setCalendarLoading] = useState(false);
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
  useEffect(() => {
    if (!token) return;
    const monthStart = `${selectedDate.slice(0, 7)}-01`;
    const monthDate = new Date(`${monthStart}T12:00:00`);
    monthDate.setMonth(monthDate.getMonth() + 1);
    const monthEnd = shiftDateKey(localDateKey(monthDate), -1);
    const fromKey = rangeActive && rangeStart < monthStart ? rangeStart : monthStart;
    const toKey = rangeActive && rangeEnd > monthEnd ? rangeEnd : monthEnd;
    const window = dateRangeIso(fromKey, toKey);
    let cancelled = false;
    const loadMonth = async () => {
      await Promise.resolve();
      if (!cancelled) setCalendarLoading(true);
      try {
        const rows = await backendApi.appointments(token, window.from, window.to);
        if (!cancelled) setCalendarAppointments(rows);
      } catch {
        if (!cancelled) setCalendarAppointments(data.appointments);
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    };
    void loadMonth();
    return () => { cancelled = true; };
  }, [token, selectedDate, rangeActive, rangeStart, rangeEnd, data.appointments]);
  const selectedAppointments = calendarAppointments.filter((appointment) => {
    const key = localDateKey(appointment.startAt);
    return rangeActive ? key >= rangeStart && key <= rangeEnd : key === selectedDate;
  });
  const dateControls = (
    <CalendarDateControls
      value={selectedDate}
      onChange={(value) => { setSelectedDate(value); setRangeActive(false); }}
      rangeStart={rangeStart}
      rangeEnd={rangeEnd}
      rangeActive={rangeActive}
      onRangeChange={(from, to) => { setRangeStart(from); setRangeEnd(to < from ? from : to); }}
      onRangeActive={setRangeActive}
    />
  );
  const advanceAppointments = calendarAppointments.filter((appointment) => new Date(appointment.startAt) > new Date() && !["COMPLETED", "CANCELLED", "NO_SHOW"].includes(appointment.status)).slice(0, 12);
  const advanceBookingsPanel = (
    <section className="admin-card advance-bookings-panel">
      <div className="card-head"><div><p className="eyebrow">Future diary</p><h2>Advance bookings</h2><p>Upcoming confirmed and pending visits, separate from today’s agenda.</p></div><span className="count-badge">{advanceAppointments.length}</span></div>
      <div>{advanceAppointments.map((appointment, index) => { const row = appointmentRow(appointment, index); return <article key={appointment.id}><time>{new Date(appointment.startAt).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}<b>{row.time}</b></time><span><strong>{row.name}</strong><small>{row.service} · {row.staff}</small></span><em>{row.status}</em><button onClick={() => { setSelectedDate(localDateKey(appointment.startAt)); setRangeActive(false); }}>Open date →</button></article>; })}{!advanceAppointments.length && <p className="empty-cart">No future bookings in this loaded calendar window.</p>}</div>
    </section>
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

  if (!selectedAppointments.length)
    return (
      <div className="calendar-view">
        <div className="calendar-toolbar">
          <div className="view-switch">
            <span className="active">Day agenda</span>
          </div>
          {dateControls}
          <span className="filter-button">{calendarLoading ? "Loading calendar…" : `No appointments ${rangeActive ? "in this range" : "on this date"}`}</span>
        </div>
        <div className="calendar-date-summary"><strong>{rangeActive ? `${new Date(`${rangeStart}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} — ${new Date(`${rangeEnd}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong><span>Month, year, day and cross-month ranges are available above.</span></div>
        <WalkInCreator key={selectedDate} token={token} data={data} selectedDate={selectedDate} onRefresh={onRefresh} />
        {advanceBookingsPanel}
        <div className="admin-card waitlist-empty">
          This date is clear. Add a walk-in or move backward/forward to another day.
        </div>
      </div>
    );

  if (selectedAppointments.length)
    return (
      <div className="calendar-view">
        <div className="calendar-toolbar">
          <div className="view-switch">
            <span className="active">Day agenda</span>
          </div>
          {dateControls}
          <span className="filter-button">
            {calendarLoading ? "Loading…" : `${selectedAppointments.length} appointment${selectedAppointments.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="calendar-date-summary"><strong>{rangeActive ? `${new Date(`${rangeStart}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })} — ${new Date(`${rangeEnd}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : new Date(`${selectedDate}T12:00:00`).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</strong><span>{selectedAppointments.filter((item) => item.isWalkIn).length} walk-ins · live backend calendar</span></div>
        <WalkInCreator key={selectedDate} token={token} data={data} selectedDate={selectedDate} onRefresh={onRefresh} />
        {advanceBookingsPanel}
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
          {selectedAppointments.map((item, index) => {
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
  return null;
}

function CalendarDateControls({
  value,
  onChange,
  rangeStart,
  rangeEnd,
  rangeActive,
  onRangeChange,
  onRangeActive,
}: {
  value: string;
  onChange: (value: string) => void;
  rangeStart: string;
  rangeEnd: string;
  rangeActive: boolean;
  onRangeChange: (from: string, to: string) => void;
  onRangeActive: (value: boolean) => void;
}) {
  const today = localDateKey(new Date());
  const selected = new Date(`${value}T12:00:00`);
  const year = selected.getFullYear();
  const month = selected.getMonth();
  const day = selected.getDate();
  const firstWeekday = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  const setMonthYear = (nextYear: number, nextMonth: number) => {
    const nextDay = Math.min(day, new Date(nextYear, nextMonth + 1, 0).getDate());
    onChange(localDateKey(new Date(nextYear, nextMonth, nextDay, 12)));
  };
  const yearOptions = Array.from({ length: 12 }, (_, index) => new Date().getFullYear() - 8 + index);
  return (
    <div className="calendar-date-suite" aria-label="Calendar date navigation">
      <div className="calendar-date-controls">
        <button onClick={() => onChange(shiftDateKey(value, -1))} aria-label="Previous date">← Previous</button>
        <button className={value === today && !rangeActive ? "active" : ""} onClick={() => onChange(today)}>Today</button>
        <select aria-label="Calendar month" value={month} onChange={(event) => setMonthYear(year, Number(event.target.value))}>
          {Array.from({ length: 12 }, (_, index) => <option key={index} value={index}>{new Date(2024, index, 1).toLocaleDateString("en-IN", { month: "long" })}</option>)}
        </select>
        <select aria-label="Calendar year" value={year} onChange={(event) => setMonthYear(Number(event.target.value), month)}>
          {yearOptions.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
        <input type="date" value={value} onChange={(event) => onChange(event.target.value || today)} aria-label="Choose calendar date" />
        <button onClick={() => onChange(shiftDateKey(value, 1))} aria-label="Next date">Next →</button>
        <button className={rangeActive ? "active" : ""} onClick={() => onRangeActive(!rangeActive)}>Date range</button>
      </div>
      <div className="calendar-picker-panel">
        <div className="mini-calendar">
          <header>{new Date(year, month, 1).toLocaleDateString("en-IN", { month: "long", year: "numeric" })}</header>
          <div className="mini-calendar-week"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
          <div className="mini-calendar-days">
            {Array.from({ length: firstWeekday }, (_, index) => <i key={`blank-${index}`} />)}
            {Array.from({ length: days }, (_, index) => {
              const key = localDateKey(new Date(year, month, index + 1, 12));
              return <button key={key} className={`${key === value && !rangeActive ? "selected" : ""} ${rangeActive && key >= rangeStart && key <= rangeEnd ? "in-range" : ""}`} onClick={() => onChange(key)}>{index + 1}</button>;
            })}
          </div>
        </div>
        <div className={`calendar-range-fields ${rangeActive ? "active" : ""}`}>
          <strong>Custom date range</strong>
          <label>From<input type="date" value={rangeStart} onChange={(event) => onRangeChange(event.target.value || today, rangeEnd)} /></label>
          <label>To<input type="date" min={rangeStart} value={rangeEnd} onChange={(event) => onRangeChange(rangeStart, event.target.value || rangeStart)} /></label>
          <button className="button admin-primary" onClick={() => onRangeActive(true)}>Apply range</button>
          <small>Ranges can cross month and year boundaries.</small>
        </div>
      </div>
    </div>
  );
}

function WalkInCreator({
  token,
  data,
  selectedDate,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  selectedDate: string;
  onRefresh: () => void;
}) {
  const services = data.categories.flatMap((category) => category.services);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [startAt, setStartAt] = useState(() => `${selectedDate}T10:00`);
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
  addProduct,
  assignStaff,
  assignCompanion,
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
  customerId,
  onCustomerIdChange,
  headerCustomerSearch,
  onHeaderCustomerSearchChange,
  onRefresh,
  onOpenCashbook,
}: {
  cart: CartItem[];
  services: SaleService[];
  token: string;
  data: BackendSnapshot;
  addItem: (item: SaleService) => void;
  addProduct: (item: BackendSnapshot["products"][number]) => void;
  assignStaff: (index: number, staffId: string) => void;
  assignCompanion: (index: number, companionId: string) => void;
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
  customerId: string;
  onCustomerIdChange: (value: string) => void;
  headerCustomerSearch: string;
  onHeaderCustomerSearchChange: (value: string) => void;
  onRefresh: () => void;
  onOpenCashbook: () => void;
}) {
  const [invoice, setInvoice] = useState("");
  const [invoiceId, setInvoiceId] = useState("");
  const [checkoutError, setCheckoutError] = useState("");
  const [charging, setCharging] = useState(false);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogFilter, setCatalogFilter] = useState("All");
  const [customerSearchOpen, setCustomerSearchOpen] = useState(false);
  const [posCustomerResults, setPosCustomerResults] = useState<BackendCustomer[]>([]);
  const [posCustomerSearching, setPosCustomerSearching] = useState(false);
  const [customerDetail, setCustomerDetail] =
    useState<BackendCustomerDetail | null>(null);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickCustomerName, setQuickCustomerName] = useState("");
  const [quickCustomerPhone, setQuickCustomerPhone] = useState("");
  const [quickCustomerEmail, setQuickCustomerEmail] = useState("");
  const [quickCustomerVisitDate, setQuickCustomerVisitDate] = useState("");
  const [quickCustomerService, setQuickCustomerService] = useState("");
  const [quickCustomerAmount, setQuickCustomerAmount] = useState(0);
  const [quickCustomerWaConsent, setQuickCustomerWaConsent] = useState(false);
  const [quickCustomerEmailConsent, setQuickCustomerEmailConsent] = useState(false);
  const [quickCustomerBusy, setQuickCustomerBusy] = useState(false);
  const [quickCustomerMessage, setQuickCustomerMessage] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [packageRedemptionEnabled, setPackageRedemptionEnabled] = useState(true);
  const [couponCode, setCouponCode] = useState("");
  const [loyaltyPoints, setLoyaltyPoints] = useState(0);
  const [redeemLoyalty, setRedeemLoyalty] = useState(false);
  const [rewardMessage, setRewardMessage] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<
    "CASH" | "UPI" | "CARD" | "SPLIT"
  >("UPI");
  const [receiptEmailEnabled, setReceiptEmailEnabled] = useState(false);
  const [receiptWhatsappChannel, setReceiptWhatsappChannel] = useState<
    "OFF" | "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL"
  >("OFF");
  const [deliveryMessage, setDeliveryMessage] = useState("");
  const [whatsappActionFeedback, setWhatsappActionFeedback] = useState<{
    channel: InvoiceWhatsAppChannel;
    state: "sending" | "success" | "error";
    message: string;
  } | null>(null);
  const [openingBreakdown, setOpeningBreakdown] = useState<CashBreakdown>(emptyCashBreakdown);
  const [openingConfirmation, setOpeningConfirmation] = useState(0);
  const [openingCountAcknowledged, setOpeningCountAcknowledged] = useState(false);
  const [openingNote, setOpeningNote] = useState("");
  const [openingBusy, setOpeningBusy] = useState(false);
  const openingCashMinor = cashBreakdownTotalMinor(openingBreakdown);
  const openingCountConfirmed = openingCountAcknowledged && Math.round(openingConfirmation * 100) === openingCashMinor;
  const customer = data.customers.find((item) => item.id === customerId);
  const selectedCustomer = customer ?? (customerDetail?.id === customerId ? customerDetail : null);
  const serviceCategory = new Map(
    data.categories.flatMap((category) =>
      category.services.map((service) => [service.id, categoryDisplayName(category)] as const),
    ),
  );
  const serviceCategoryGroups = new Map(
    data.categories.flatMap((category) =>
      category.services.map((service) => [service.id, categoryGroupName(category)] as const),
    ),
  );
  const catalogFilters = [
    "All",
    ...Array.from(new Set(data.categories.flatMap((category) => [categoryGroupName(category), categoryDisplayName(category)]))),
    "Products",
  ];
  const queryKey = catalogQuery.trim().toLowerCase();
  const visibleServices = services.filter(
    (service) =>
      catalogFilter !== "Products" &&
      (catalogFilter === "All" || serviceCategory.get(service.id) === catalogFilter || serviceCategoryGroups.get(service.id) === catalogFilter) &&
      (!queryKey || service.name.toLowerCase().includes(queryKey)),
  );
  const visibleProducts = data.products.filter(
    (product) =>
      product.isActive !== false &&
      product.stockQty > 0 &&
      (catalogFilter === "All" || catalogFilter === "Products") &&
      (!queryKey || `${product.name} ${product.brand ?? ""} ${product.sku ?? ""}`.toLowerCase().includes(queryKey)),
  );
  const posCustomerQuery = headerCustomerSearch.trim();
  const posCustomerDigits = posCustomerQuery.replace(/\D/gu, "");
  const matchingCustomers = posCustomerResults;
  const membership = customerDetail?.memberships.find(
    (item) => item.id === membershipId && item.isActive,
  );
  const packageEntitlements = (customerDetail?.servicePackages ?? []).flatMap(
    (enrollment) =>
      enrollment.package.items.flatMap((item) => {
        const balance = enrollment.ledger
          .filter((entry) => entry.serviceId === item.serviceId)
          .reduce((sum, entry) => sum + entry.qtyDelta, 0);
        const isExpired = enrollment.expiresAt
          ? new Date(enrollment.expiresAt) < new Date()
          : false;
        const cartQty = cart.filter((line) => line.kind === "service" && line.serviceId === item.serviceId).length;
        return enrollment.isActive && !isExpired && balance > 0
          ? [
              {
                key: `${enrollment.id}:${item.serviceId}`,
                customerServicePackageId: enrollment.id,
                serviceId: item.serviceId,
                label: `${enrollment.package.name} · ${item.service.name}`,
                balance,
                included: item.qty,
                used: Math.max(0, item.qty - balance),
                cartQty,
              },
            ]
          : [];
      }),
  );
  const packageDemand = new Map<string, number>();
  for (const line of cart) if (line.kind === "service" && line.serviceId) packageDemand.set(line.serviceId, (packageDemand.get(line.serviceId) ?? 0) + 1);
  const packageRedemptions = packageRedemptionEnabled ? packageEntitlements.flatMap((option) => {
    const demand = packageDemand.get(option.serviceId) ?? 0;
    const qty = Math.min(demand, option.balance);
    if (qty > 0) packageDemand.set(option.serviceId, demand - qty);
    return qty ? [{ customerServicePackageId: option.customerServicePackageId, serviceId: option.serviceId, qty, label: option.label }] : [];
  }) : [];
  const coveredQtyByService = new Map<string, number>();
  for (const redemption of packageRedemptions) coveredQtyByService.set(redemption.serviceId, (coveredQtyByService.get(redemption.serviceId) ?? 0) + redemption.qty);
  const packageDiscountMinor = cart.reduce((sum, line) => {
    if (line.kind !== "service" || !line.serviceId) return sum;
    const remaining = coveredQtyByService.get(line.serviceId) ?? 0;
    if (!remaining) return sum;
    coveredQtyByService.set(line.serviceId, remaining - 1);
    const base = line.price * 100;
    return sum + base;
  }, 0);
  const payableMinor = Math.max(0, total * 100 - packageDiscountMinor);
  const loyaltySettings = data.settings.loyalty as Record<string, unknown> | undefined;
  const loyaltyRules = {
    enabled: Boolean(loyaltySettings?.enabled ?? true),
    minRedeemPoints: Number(loyaltySettings?.minRedeemPoints ?? 50),
    redeemMinorPerPoint: Number(loyaltySettings?.redeemMinorPerPoint ?? 100),
  };
  const normalizedCouponCode = couponCode.trim().toUpperCase();
  const selectedCoupon = data.coupons.find((coupon) => coupon.code === normalizedCouponCode);
  const couponAvailable = Boolean(
    selectedCoupon?.isActive &&
      (!selectedCoupon.startsAt || new Date(selectedCoupon.startsAt) <= new Date()) &&
      (!selectedCoupon.endsAt || new Date(selectedCoupon.endsAt) >= new Date()) &&
      payableMinor >= (selectedCoupon.minSpendMinor ?? 0) &&
      (!selectedCoupon.usageLimit || selectedCoupon.usedCount < selectedCoupon.usageLimit) &&
      (!selectedCoupon.perCustomerLimit || customerId),
  );
  const rawCouponDiscount = selectedCoupon
    ? selectedCoupon.type === "PERCENTAGE"
      ? Math.round((payableMinor * selectedCoupon.value) / 10_000)
      : selectedCoupon.value
    : 0;
  const couponDiscountMinor = couponAvailable
    ? Math.min(payableMinor, selectedCoupon?.maxDiscountMinor ? Math.min(rawCouponDiscount, selectedCoupon.maxDiscountMinor) : rawCouponDiscount)
    : 0;
  const afterCouponMinor = Math.max(0, payableMinor - couponDiscountMinor);
  const loyaltyBalance = customerDetail?.loyaltyPoints ?? customer?.loyaltyPoints ?? 0;
  const maxLoyaltyPoints = loyaltyRules.enabled
    ? Math.min(loyaltyBalance, Math.floor(afterCouponMinor / loyaltyRules.redeemMinorPerPoint))
    : 0;
  const effectiveLoyaltyPoints = redeemLoyalty ? loyaltyPoints : 0;
  const loyaltyRedemptionValid =
    effectiveLoyaltyPoints === 0 ||
    (effectiveLoyaltyPoints >= loyaltyRules.minRedeemPoints && effectiveLoyaltyPoints <= maxLoyaltyPoints);
  const loyaltyMinor = effectiveLoyaltyPoints > 0 && loyaltyRedemptionValid
    ? effectiveLoyaltyPoints * loyaltyRules.redeemMinorPerPoint
    : 0;
  const redeemMinor =
    memberCredit && membership
      ? Math.min(membership.balanceMinor, afterCouponMinor - loyaltyMinor)
      : 0;
  const emailDeliveryBlockedReason = !selectedCustomer
    ? "Select a customer before sending a receipt."
    : !selectedCustomer.email
      ? "This customer does not have an email address."
      : !selectedCustomer.emailConsent
        ? "Email consent is not recorded for this customer."
        : "";
  const whatsappDeliveryBlockedReason = !selectedCustomer
    ? "Select a customer before sending a receipt."
    : !selectedCustomer.phone
      ? "This customer does not have a mobile number."
      : !selectedCustomer.waConsent
        ? "WhatsApp consent is not recorded for this customer."
        : "";
  const postPaymentWhatsappBlockedReason = !token
    ? "The backend is disconnected. Reconnect it, then retry."
    : !invoiceId
      ? "The invoice is not ready to send. Reopen it from Invoice archive and retry."
      : !selectedCustomer
        ? "No customer is attached to this bill. Start a new bill with a customer selected."
        : !selectedCustomer.phone
          ? `Add a mobile number for ${selectedCustomer.name} in Customers, then retry from Invoice archive.`
          : !selectedCustomer.waConsent
            ? `Record WhatsApp consent for ${selectedCustomer.name} in Customers, then retry from Invoice archive.`
            : "";
  const whatsappActionStatusState =
    whatsappActionFeedback?.state ??
    (postPaymentWhatsappBlockedReason ? "error" : "ready");
  const whatsappActionStatusMessage =
    whatsappActionFeedback?.message ??
    (postPaymentWhatsappBlockedReason
      ? `WhatsApp unavailable: ${postPaymentWhatsappBlockedReason}`
      : `Ready to send ${invoice || "this invoice"} to ${selectedCustomer?.phone}. Delivery runs in the background; no WhatsApp window will open here.`);

  const selectCustomer = (nextCustomerId: string) => {
    onCustomerIdChange(nextCustomerId);
    setCustomerDetail(null);
    setMembershipId("");
    setPackageRedemptionEnabled(true);
    setMemberCredit(false);
    setLoyaltyPoints(0);
    setRedeemLoyalty(false);
    setQuickCustomerMessage("");
    setReceiptEmailEnabled(false);
    setReceiptWhatsappChannel("OFF");
    setWhatsappActionFeedback(null);
  };

  const selectSearchCustomer = (nextCustomer: BackendSnapshot["customers"][number]) => {
    const selectedLabel = nextCustomer.phone ?? nextCustomer.name;
    onHeaderCustomerSearchChange(selectedLabel);
    setCustomerSearchOpen(false);
    selectCustomer(nextCustomer.id);
  };

  const openQuickCustomerFromSearch = () => {
    setShowQuickCustomer(true);
    setQuickCustomerMessage("");
    setCustomerSearchOpen(false);
    if (posCustomerDigits) setQuickCustomerPhone(posCustomerDigits);
    else if (posCustomerQuery) setQuickCustomerName(posCustomerQuery);
    window.setTimeout(() => {
      document
        .getElementById("pos-quick-customer-form")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 0);
  };

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
        setPackageRedemptionEnabled(true);
        // Prepaid service entitlements apply automatically. Monetary membership
        // credit remains an explicit cashier choice so an unrelated extra
        // service is still billed unless the customer asks to use their credit.
        setMemberCredit(false);
      })
      .catch(() => {
        if (!cancelled) setCustomerDetail(null);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId, setMemberCredit, token]);

  useEffect(() => {
    if (!token || !posCustomerQuery) {
      setPosCustomerResults([]);
      setPosCustomerSearching(false);
      return;
    }
    let cancelled = false;
    setPosCustomerSearching(true);
    const timer = window.setTimeout(() => {
      backendApi
        .customerDirectory(token, { q: posCustomerQuery, take: 8 })
        .then((result) => {
          if (!cancelled) setPosCustomerResults(result.customers);
        })
        .catch(() => {
          if (!cancelled) setPosCustomerResults([]);
        })
        .finally(() => {
          if (!cancelled) setPosCustomerSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [posCustomerQuery, token]);

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
    if (normalizedCouponCode && !couponAvailable) {
      setCheckoutError("Coupon is invalid, inactive, expired or does not meet its minimum spend.");
      return;
    }
    if (!loyaltyRedemptionValid) {
      setCheckoutError(`Redeem at least ${loyaltyRules.minRedeemPoints} points and no more than ${maxLoyaltyPoints}.`);
      return;
    }
    setCharging(true);
    setCheckoutError("");
    setDeliveryMessage("");
    setWhatsappActionFeedback(null);
    setRewardMessage("");
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
        ...manualPayments(afterCouponMinor - loyaltyMinor - redeemMinor),
      ];
      const result = await backendApi.checkout(token, {
        branchId: "main",
        customerId: customerId || undefined,
        lines: cart.map((item) => ({
          kind: item.kind,
          serviceId: item.serviceId,
          productId: item.productId,
          staffId: item.staffId ?? (item.kind === "service" ? data.staff.find((staff) => staff.displayName === item.staff)?.id : undefined),
          description: item.name,
          qty: 1,
          unitMinor: item.price * 100,
          discountMinor: 0,
          taxRateBps: 0,
          companionId: item.companionId,
        })),
        payments,
        packageRedemptions: packageRedemptions.map(({ customerServicePackageId, serviceId, qty }) => ({ customerServicePackageId, serviceId, qty })),
        couponCode: normalizedCouponCode || undefined,
        loyaltyPointsToRedeem: effectiveLoyaltyPoints,
      });
      setInvoice(result.number);
      setInvoiceId(result.id);
      setPaid(true);
      setRewardMessage(
        `${result.loyalty.redeemedPoints ? `${result.loyalty.redeemedPoints} points redeemed. ` : ""}${result.loyalty.earnedPoints} points earned${result.loyalty.balanceAfter != null ? ` · balance ${result.loyalty.balanceAfter}` : ""}.`,
      );
      let pdfMessage = "Branded PDF invoice ready.";
      try {
        await backendApi.generateInvoicePdf(token, result.id);
      } catch {
        pdfMessage = "Invoice saved; PDF can be generated again.";
      }

      const deliveryJobs: Array<{
        label: string;
        promise: Promise<unknown>;
      }> = [];
      if (receiptEmailEnabled && !emailDeliveryBlockedReason) {
        deliveryJobs.push({
          label: "email",
          promise: backendApi.sendInvoice(token, result.id, "EMAIL"),
        });
      }
      if (
        receiptWhatsappChannel !== "OFF" &&
        !whatsappDeliveryBlockedReason
      ) {
        deliveryJobs.push({
          label:
            receiptWhatsappChannel === "WHATSAPP_OFFICIAL"
              ? "official WhatsApp"
              : "unofficial WhatsApp",
          promise: backendApi.sendInvoice(
            token,
            result.id,
            receiptWhatsappChannel,
          ),
        });
      }
      if (!deliveryJobs.length) {
        setDeliveryMessage(`${pdfMessage} Automatic delivery was off.`);
      } else {
        const deliveryResults = await Promise.allSettled(
          deliveryJobs.map((job) => job.promise),
        );
        const delivered = deliveryJobs
          .filter((_, index) => deliveryResults[index]?.status === "fulfilled")
          .map((job) => job.label);
        const failed = deliveryJobs
          .filter((_, index) => deliveryResults[index]?.status === "rejected")
          .map((job) => job.label);
        setDeliveryMessage(
          [
            pdfMessage,
            delivered.length
              ? `Receipt queued via ${delivered.join(" + ")}.`
              : "",
            failed.length
              ? `${failed.join(" + ")} delivery failed; use the retry buttons below.`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
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
  const whatsappInvoice = async (channel: InvoiceWhatsAppChannel) => {
    const channelLabel =
      channel === "WHATSAPP_OFFICIAL"
        ? "Official WhatsApp"
        : "Unofficial WhatsApp";
    if (postPaymentWhatsappBlockedReason) {
      setCheckoutError("");
      setWhatsappActionFeedback({
        channel,
        state: "error",
        message: `${channelLabel} unavailable: ${postPaymentWhatsappBlockedReason}`,
      });
      return;
    }
    if (charging) return;
    setCharging(true);
    setCheckoutError("");
    setWhatsappActionFeedback({
      channel,
      state: "sending",
      message: `Sending ${invoice || "invoice"} through ${channelLabel} to ${selectedCustomer?.phone}…`,
    });
    try {
      const result = await backendApi.sendInvoice(token, invoiceId, channel);
      const outcome = result.queued
        ? "queued"
        : result.status
          ? prettyStatus(result.status).toLowerCase()
          : "processed";
      setWhatsappActionFeedback({
        channel,
        state: "success",
        message: `${invoice || "Invoice"} ${outcome} through ${channelLabel} to ${selectedCustomer?.phone}. Delivery runs in the background; no WhatsApp window opens here.`,
      });
    } catch (cause) {
      const reason =
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "WhatsApp invoice failed";
      setWhatsappActionFeedback({
        channel,
        state: "error",
        message: `${channelLabel} failed: ${reason}. Check the customer's phone and consent plus the provider status in Settings, then retry.`,
      });
    } finally {
      setCharging(false);
    }
  };
  const openBusinessDay = async () => {
    if (!token) return;
    setOpeningBusy(true);
    setCheckoutError("");
    try {
      await backendApi.openCashSession(token, {
        branchId: "main",
        openingCashMinor,
        openingBreakdown,
        openingNote: openingNote.trim() || undefined,
      });
      setOpeningBreakdown(emptyCashBreakdown());
      setOpeningConfirmation(0);
      setOpeningCountAcknowledged(false);
      setOpeningNote("");
      onRefresh();
    } catch (cause) {
      setCheckoutError(cause instanceof Error ? prettyStatus(cause.message) : "Business day could not be opened.");
    } finally {
      setOpeningBusy(false);
    }
  };
  const createQuickCustomer = async () => {
    if (!token || !quickCustomerName.trim()) return;
    if (quickCustomerVisitDate && !quickCustomerService.trim()) {
      setQuickCustomerMessage("Add the earlier service name so the dated visit can be saved correctly.");
      return;
    }
    setQuickCustomerBusy(true);
    setQuickCustomerMessage("");
    try {
      const phone = quickCustomerPhone.trim();
      const existing = phone.replace(/\D/gu, "").length >= 8
        ? await backendApi.lookupCustomer(token, phone)
        : null;
      if (existing) {
        onHeaderCustomerSearchChange(existing.phone ?? existing.name);
        selectCustomer(existing.id);
        setCustomerDetail(await backendApi.customerDetail(token, existing.id));
        setShowQuickCustomer(false);
        setQuickCustomerMessage(`${existing.name} already exists and is now selected.`);
        return;
      }
      const created = await backendApi.createCustomer(token, {
        branchId: "main",
        name: quickCustomerName.trim(),
        phone: phone || undefined,
        email: quickCustomerEmail.trim() || undefined,
        source: "walk_in",
        waConsent: quickCustomerWaConsent,
        emailConsent: quickCustomerEmailConsent,
        initialVisit: quickCustomerVisitDate && quickCustomerService.trim()
          ? {
              visitedAt: new Date(`${quickCustomerVisitDate}T12:00:00`).toISOString(),
              serviceName: quickCustomerService.trim(),
              amountMinor: Math.round(quickCustomerAmount * 100),
            }
          : undefined,
      });
      onHeaderCustomerSearchChange(created.phone ?? created.name);
      selectCustomer(created.id);
      setCustomerDetail(await backendApi.customerDetail(token, created.id));
      setQuickCustomerName("");
      setQuickCustomerPhone("");
      setQuickCustomerEmail("");
      setQuickCustomerVisitDate("");
      setQuickCustomerService("");
      setQuickCustomerAmount(0);
      setQuickCustomerWaConsent(false);
      setQuickCustomerEmailConsent(false);
      setShowQuickCustomer(false);
      setQuickCustomerMessage(`${created.name} created and selected for this bill.`);
      onRefresh();
    } catch (cause) {
      setQuickCustomerMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Customer could not be created from POS.",
      );
    } finally {
      setQuickCustomerBusy(false);
    }
  };

  if (!data.currentCash) {
    return (
      <section className="admin-card pos-day-gate">
        <div className="pos-day-gate-copy">
          <p className="eyebrow">Required before billing</p>
          <h2>Start today’s salon drawer</h2>
          <p>Record the physical cash already in the drawer before services, products or payments can be added in POS. Closing cash and variance are completed at end of day.</p>
        </div>
        <div className="pos-day-gate-form">
          <CashDenominationCounter value={openingBreakdown} onChange={setOpeningBreakdown} title="Opening coins and notes" />
          <label>Re-enter counted total to confirm (₹)<input type="number" min="0" step="1" value={openingConfirmation || ""} placeholder="0" onChange={(event) => setOpeningConfirmation(Math.max(0, Number(event.target.value)))} /></label>
          <label className="consent-box"><input type="checkbox" checked={openingCountAcknowledged} onChange={(event) => setOpeningCountAcknowledged(event.target.checked)} /><span>I physically counted every coin and note</span></label>
          {!openingCountConfirmed && <p className="cash-mismatch-message">The confirmation amount must equal the denomination total ({money(openingCashMinor)}).</p>}
          <label>Opening note (optional)<input value={openingNote} onChange={(event) => setOpeningNote(event.target.value)} placeholder="Float counted by reception" /></label>
          <button className="button admin-primary" disabled={openingBusy || !token || !openingCountConfirmed} onClick={() => void openBusinessDay()}>{openingBusy ? "Opening drawer…" : "Open drawer & start POS"}</button>
          <button onClick={onOpenCashbook}>View previous cash sessions</button>
        </div>
        {checkoutError && <p className="checkout-error">{checkoutError}</p>}
      </section>
    );
  }
  return (
    <div className="pos-workspace">
      <div className="pos-day-strip">
        <span><small>Business date</small><strong>{data.currentCash.businessDate}</strong></span>
        <span><small>Opened</small><strong>{new Date(data.currentCash.openedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</strong></span>
        <span><small>Opening drawer</small><strong>{money(data.currentCash.openingCashMinor)}</strong></span>
        <span><small>Cash sales</small><strong>{money(data.currentCash.cashSalesMinor ?? 0)}</strong></span>
        <span><small>UPI sales</small><strong>{money(data.currentCash.upiSalesMinor ?? 0)}</strong></span>
        <span><small>Card sales</small><strong>{money(data.currentCash.cardSalesMinor ?? 0)}</strong></span>
        <span><small>Expected cash</small><strong>{money(data.currentCash.expectedCashMinor ?? data.currentCash.openingCashMinor)}</strong></span>
        <button onClick={onOpenCashbook}>Expenses / close drawer →</button>
      </div>
      <div className="pos-layout">
      <section className="pos-catalog">
        <label className="pos-search">
          <span>⌕</span>
          <input
            value={catalogQuery}
            onChange={(event) => setCatalogQuery(event.target.value)}
            placeholder="Search services, products or SKU…"
          />
        </label>
        <div className="pos-category-row">
          {catalogFilters.map((filter) => (
            <button
              type="button"
              key={filter}
              className={catalogFilter === filter ? "active" : ""}
              onClick={() => setCatalogFilter(filter)}
            >
              {filter}
            </button>
          ))}
        </div>
        <div className="pos-service-grid">
          {visibleServices.map((service, index) => (
            <button
              type="button"
              key={service.id}
              onClick={() => addItem(service)}
              aria-label={`Add ${service.name} for ₹${service.price.toLocaleString("en-IN")}`}
            >
              <span className={`tile-icon tile-${index % 6}`}>
                {service.name
                  .split(" ")
                  .map((word) => word[0])
                  .join("")
                  .slice(0, 2)}
              </span>
              <span className="pos-service-copy">
                <small className="pos-service-category">{serviceCategory.get(service.id) ?? "Salon service"}</small>
                <strong>{service.name}</strong>
                <small>{service.duration}</small>
              </span>
              <span className="pos-service-price">
                <b>₹{service.price.toLocaleString("en-IN")}</b>
                <i aria-hidden="true">+</i>
              </span>
            </button>
          ))}
          {visibleProducts.map((product, index) => (
              <button type="button" key={product.id} onClick={() => addProduct(product)} aria-label={`Add ${product.name} for ${money(product.sellMinor)}`}>
                <span className={`tile-icon tile-${(index + visibleServices.length) % 6}`}>PR</span>
                <span className="pos-service-copy">
                  <small className="pos-service-category">Retail product</small>
                  <strong>{product.name}</strong>
                  <small>{product.stockQty} in stock{product.sku ? ` · ${product.sku}` : ""}</small>
                </span>
                <span className="pos-service-price">
                  <b>{money(product.sellMinor)}</b>
                  <i aria-hidden="true">+</i>
                </span>
              </button>
            ))}
          {!visibleServices.length && !visibleProducts.length && (
            <p className="empty-cart">No matching services or products.</p>
          )}
        </div>
      </section>
      <aside className="pos-cart admin-card">
        <div className="pos-customer">
          <span>
            {selectedCustomer
              ? selectedCustomer.name
                  .split(" ")
                  .map((part) => part[0])
                  .join("")
                  .slice(0, 2)
              : "CU"}
          </span>
          <div>
            <small>Customer</small>
            <strong>{selectedCustomer?.name ?? "Walk-in / guest"}</strong>
            <p>
              {selectedCustomer
                ? `${selectedCustomer.visitCount} visits · ${selectedCustomer.loyaltyPoints} loyalty points`
                : "Choose a customer for CRM and membership"}
            </p>
          </div>
          <div className="pos-customer-lookup">
            <label className="pos-customer-search" htmlFor="pos-customer-search">
              <span>Find customer by name or phone</span>
              <input
                id="pos-customer-search"
                type="search"
                autoComplete="off"
                value={headerCustomerSearch}
                onFocus={() => setCustomerSearchOpen(true)}
                onBlur={() => window.setTimeout(() => setCustomerSearchOpen(false), 150)}
                onChange={(event) => {
                  const nextSearch = event.target.value;
                  onHeaderCustomerSearchChange(nextSearch);
                  setCustomerSearchOpen(true);
                }}
                onInput={(event) => {
                  onHeaderCustomerSearchChange(event.currentTarget.value);
                  setCustomerSearchOpen(true);
                }}
                placeholder="Type any part of a name or phone number"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={customerSearchOpen && Boolean(posCustomerQuery)}
                aria-controls="pos-customer-results"
              />
            </label>
            {customerSearchOpen && posCustomerQuery && (
              <div
                id="pos-customer-results"
                className="pos-customer-results"
                role="listbox"
                aria-label="Matching customers"
              >
                {posCustomerSearching && (
                  <div className="pos-customer-no-results" role="status">
                    Searching live customer database…
                  </div>
                )}
                {matchingCustomers.map((item) => (
                  <button
                    type="button"
                    role="option"
                    aria-selected={item.id === customerId}
                    key={item.id}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectSearchCustomer(item)}
                  >
                    <span>{initialsFor(item.name)}</span>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.phone ?? "No phone number"}</small>
                    </span>
                    <small>{item.visitCount} visits</small>
                  </button>
                ))}
                {!posCustomerSearching && !matchingCustomers.length && (
                  <div className="pos-customer-no-results" role="status">
                    <span>
                      <strong>No matching customer</strong>
                      <small>Create a profile without leaving this bill.</small>
                    </span>
                    <button
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={openQuickCustomerFromSearch}
                    >
                      + Add new customer
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="pos-customer-actions">
            <button
              type="button"
              className="pos-add-customer-button"
              aria-expanded={showQuickCustomer}
              onClick={() => {
                const opening = !showQuickCustomer;
                setShowQuickCustomer(opening);
                setQuickCustomerMessage("");
                if (opening) {
                  window.setTimeout(() => {
                    document
                      .getElementById("pos-quick-customer-form")
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }, 0);
                }
              }}
            >
              {showQuickCustomer ? "Close new customer" : "+ Add new customer"}
            </button>
            {customerId && (
              <button type="button" className="pos-clear-customer-button" onClick={() => { selectCustomer(""); onHeaderCustomerSearchChange(""); }}>
                Use walk-in instead
              </button>
            )}
          </div>
          {showQuickCustomer && (
            <form
              id="pos-quick-customer-form"
              className="pos-quick-customer"
              onSubmit={(event) => {
                event.preventDefault();
                void createQuickCustomer();
              }}
            >
              <header>
                <div><strong>Add customer without leaving POS</strong><small>Phone is checked first so an existing profile is never duplicated.</small></div>
              </header>
              <label>
                Customer name
                <input autoFocus value={quickCustomerName} onChange={(event) => setQuickCustomerName(event.target.value)} placeholder="Full name" required />
              </label>
              <label>
                Mobile number
                <input inputMode="tel" value={quickCustomerPhone} onChange={(event) => setQuickCustomerPhone(event.target.value)} placeholder="10-digit number" />
              </label>
              <label>
                Email (optional)
                <input type="email" value={quickCustomerEmail} onChange={(event) => setQuickCustomerEmail(event.target.value)} placeholder="name@example.com" />
              </label>
              <label>
                Customer since / earlier visit date
                <input type="date" max={new Date().toISOString().slice(0, 10)} value={quickCustomerVisitDate} onChange={(event) => setQuickCustomerVisitDate(event.target.value)} />
              </label>
              {quickCustomerVisitDate && (
                <>
                  <label>
                    Earlier service
                    <input value={quickCustomerService} onChange={(event) => setQuickCustomerService(event.target.value)} placeholder="Haircut, colour, facial…" required />
                  </label>
                  <label>
                    Earlier sale (₹)
                    <input type="number" min="0" step="1" value={quickCustomerAmount || ""} onChange={(event) => setQuickCustomerAmount(Math.max(0, Number(event.target.value)))} placeholder="0" />
                  </label>
                </>
              )}
              <div className="pos-quick-consents">
                <label className="pos-quick-consent">
                  <input type="checkbox" checked={quickCustomerWaConsent} onChange={(event) => setQuickCustomerWaConsent(event.target.checked)} />
                  <span>Customer agreed to receive WhatsApp service updates</span>
                </label>
                <label className="pos-quick-consent">
                  <input type="checkbox" checked={quickCustomerEmailConsent} onChange={(event) => setQuickCustomerEmailConsent(event.target.checked)} />
                  <span>Customer agreed to receive email receipts and updates</span>
                </label>
              </div>
              <button className="button admin-primary" type="submit" disabled={quickCustomerBusy || !token || !quickCustomerName.trim() || Boolean(quickCustomerVisitDate && !quickCustomerService.trim())}>
                {quickCustomerBusy ? "Checking & selecting…" : "Save & Select Customer"}
              </button>
            </form>
          )}
          {quickCustomerMessage && <p className="pos-customer-message" aria-live="polite">{quickCustomerMessage}</p>}
        </div>
        <div className="cart-items">
          {cart.length ? (
            cart.map((item, index) => (
              <div key={`${item.id}-${index}`}>
                <span>
                  <strong>{item.name}</strong>
                  <small>{item.kind === "service" ? `with ${item.staff}` : item.staffId ? `Retail by ${item.staff}` : "Assign staff for retail commission"}</small>
                  {item.kind === "service" && customerDetail && <select value={item.companionId ?? ""} onChange={(event) => assignCompanion(index, event.target.value)} aria-label={`Service recipient for ${item.name}`}><option value="">For {customerDetail.name} (primary)</option>{customerDetail.companions.map((companion) => <option key={companion.id} value={companion.id}>For {companion.name}{companion.relation ? ` · ${companion.relation}` : ""}</option>)}</select>}
                  {item.kind === "product" && <select value={item.staffId ?? ""} onChange={(event) => assignStaff(index, event.target.value)} aria-label={`Assign staff for ${item.name}`}><option value="">No staff commission</option>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName}</option>)}</select>}
                </span>
                <strong><small>MRP</small> ₹{item.price.toLocaleString("en-IN")}</strong>
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
        <section className="pos-entitlement-wallet">
          <header><div><strong>Prepaid services</strong><small>Available services are matched to this cart automatically.</small></div><button type="button" className={`toggle ${packageRedemptionEnabled ? "active" : ""}`} disabled={!packageEntitlements.length} onClick={() => setPackageRedemptionEnabled((current) => !current)} aria-label="Use prepaid service entitlements"><i /></button></header>
          {packageEntitlements.map((option) => <div key={option.key} className={option.cartQty ? "matched" : ""}><span><strong>{option.label}</strong><small>{option.used} used · {option.balance} remaining of {option.included}</small></span><b>{option.cartQty ? `${Math.min(option.cartQty, option.balance)} applies now` : "Available"}</b></div>)}
          {customerId && !packageEntitlements.length && <p>No prepaid service balance is active for this customer.</p>}
          {!customerId && <p>Search the customer to see membership and package balances.</p>}
        </section>
        <div className="pos-reward-controls">
          <label>
            <span>Coupon code</span>
            <input list="pos-coupons" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Enter code" />
            <datalist id="pos-coupons">
              {data.coupons.filter((coupon) => coupon.isActive).map((coupon) => <option key={coupon.id} value={coupon.code}>{coupon.name}</option>)}
            </datalist>
            {normalizedCouponCode && <small className={couponAvailable ? "valid" : "invalid"}>{couponAvailable ? `${selectedCoupon?.name} applied` : "Code is not currently eligible"}</small>}
          </label>
          <div className="pos-loyalty-choice">
            <span>Redeem loyalty points?</span>
            <div><button type="button" className={!redeemLoyalty ? "active" : ""} onClick={() => { setRedeemLoyalty(false); setLoyaltyPoints(0); }}>No</button><button type="button" className={redeemLoyalty ? "active" : ""} disabled={!customerId || !loyaltyRules.enabled || !loyaltyBalance} onClick={() => setRedeemLoyalty(true)}>Yes</button></div>
            {redeemLoyalty && <input aria-label="Loyalty points to redeem" type="number" min="0" max={maxLoyaltyPoints} step="1" value={loyaltyPoints || ""} placeholder="Points" onChange={(event) => setLoyaltyPoints(Math.max(0, Number(event.target.value)))} />}
            <small>{customerId ? `${loyaltyBalance} available · min ${loyaltyRules.minRedeemPoints} · max ${maxLoyaltyPoints}` : "Choose a customer first"}</small>
          </div>
        </div>
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
          {packageDiscountMinor > 0 && (
            <p className="discount-line">
              <span>Service package entitlement</span>
              <strong>−{money(packageDiscountMinor)}</strong>
            </p>
          )}
          {couponDiscountMinor > 0 && (
            <p className="discount-line">
              <span>Coupon · {selectedCoupon?.code}</span>
              <strong>−{money(couponDiscountMinor)}</strong>
            </p>
          )}
          {loyaltyMinor > 0 && (
            <p className="discount-line">
              <span>Loyalty tender · {effectiveLoyaltyPoints} pts</span>
              <strong>−{money(loyaltyMinor)}</strong>
            </p>
          )}
          <p className="bill-total">
            <span>Total</span>
            <strong>{money(afterCouponMinor)}</strong>
          </p>
        </div>
        {!paid && (
          <section className="pos-receipt-delivery" aria-labelledby="pos-receipt-delivery-title">
            <header>
              <div>
                <strong id="pos-receipt-delivery-title">Receipt delivery — choose before payment</strong>
                <small>The sale stays saved even if a delivery provider is unavailable.</small>
              </div>
              <span>Before payment</span>
            </header>
            <label className={`pos-receipt-email ${emailDeliveryBlockedReason ? "disabled" : ""}`}>
              <input
                type="checkbox"
                checked={receiptEmailEnabled}
                disabled={Boolean(emailDeliveryBlockedReason) || charging}
                onChange={(event) => setReceiptEmailEnabled(event.target.checked)}
              />
              <span>
                <strong>Email PDF receipt</strong>
                <small>
                  {emailDeliveryBlockedReason || selectedCustomer?.email}
                </small>
              </span>
            </label>
            <div className={`pos-receipt-whatsapp ${whatsappDeliveryBlockedReason ? "disabled" : ""}`}>
              <span>
                <strong>WhatsApp receipt</strong>
                <small>
                  {whatsappDeliveryBlockedReason || selectedCustomer?.phone}
                </small>
              </span>
              <div role="radiogroup" aria-label="WhatsApp receipt channel">
                {([
                  ["OFF", "Off"],
                  ["WHATSAPP_OFFICIAL", "Official"],
                  ["WHATSAPP_UNOFFICIAL", "Unofficial"],
                ] as const).map(([channel, label]) => (
                  <button
                    type="button"
                    role="radio"
                    aria-checked={receiptWhatsappChannel === channel}
                    className={receiptWhatsappChannel === channel ? "active" : ""}
                    disabled={Boolean(whatsappDeliveryBlockedReason) || charging}
                    key={channel}
                    onClick={() => setReceiptWhatsappChannel(channel)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </section>
        )}
        {checkoutError && <p className="checkout-error" role="alert">{checkoutError}</p>}
        {paid ? (
          <div className="payment-success" aria-labelledby="pos-payment-success-title">
            <span aria-hidden="true">✓</span>
            <p>
              <strong id="pos-payment-success-title">Invoice and payment saved</strong>
              <small>{invoice || "Invoice ready"}</small>
            </p>
            {(deliveryMessage || rewardMessage) && (
              <div className="payment-success-details" aria-live="polite">
                {deliveryMessage && <small>{deliveryMessage}</small>}
                {rewardMessage && <small>{rewardMessage}</small>}
              </div>
            )}
            <div className="invoice-actions" aria-label="Invoice actions">
              <button type="button" disabled={charging} onClick={() => void openInvoice()}>
                Open PDF
              </button>
              <button
                type="button"
                disabled={charging || !selectedCustomer?.email}
                onClick={() => void emailInvoice()}
              >
                Email invoice
              </button>
              {([
                ["WHATSAPP_OFFICIAL", "Official WhatsApp"],
                ["WHATSAPP_UNOFFICIAL", "Unofficial WhatsApp"],
              ] as const).map(([channel, label]) => (
                <button
                  type="button"
                  key={channel}
                  disabled={charging}
                  aria-disabled={Boolean(postPaymentWhatsappBlockedReason)}
                  aria-describedby="pos-whatsapp-action-status"
                  title={postPaymentWhatsappBlockedReason || `Send ${invoice || "invoice"} to ${selectedCustomer?.phone}`}
                  onClick={() => void whatsappInvoice(channel)}
                >
                  {whatsappActionFeedback?.state === "sending" &&
                  whatsappActionFeedback.channel === channel
                    ? "Sending…"
                    : label}
                </button>
              ))}
            </div>
            <p
              id="pos-whatsapp-action-status"
              className={`invoice-action-feedback ${whatsappActionStatusState}`}
              role={whatsappActionStatusState === "error" ? "alert" : "status"}
              aria-live={whatsappActionStatusState === "error" ? "assertive" : "polite"}
            >
              {whatsappActionStatusMessage}
            </p>
            <button
              type="button"
              className="new-bill-action"
              onClick={() => {
                setPaid(false);
                setInvoice("");
                setInvoiceId("");
                setDeliveryMessage("");
                setPackageRedemptionEnabled(true);
                setCouponCode("");
                setLoyaltyPoints(0);
                setRedeemLoyalty(false);
                setRewardMessage("");
                setReceiptEmailEnabled(false);
                setReceiptWhatsappChannel("OFF");
                setWhatsappActionFeedback(null);
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
                : `Mark payment · ${money(afterCouponMinor - loyaltyMinor - redeemMinor)}`}{" "}
              <span>→</span>
            </button>
          </>
        )}
      </aside>
      </div>
    </div>
  );
}

function Customers({
  token,
  data,
  customerSearchQuery,
  setCustomerSearchQuery,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  customerSearchQuery: string;
  setCustomerSearchQuery: (value: string) => void;
  onRefresh: () => void;
}) {
  const [segment, setSegment] = useState<CustomerDirectorySegment>("ALL");
  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState("walk_in");
  const [referralName, setReferralName] = useState("");
  const [referralPhone, setReferralPhone] = useState("");
  const [waConsent, setWaConsent] = useState(false);
  const [emailConsent, setEmailConsent] = useState(false);
  const [initialVisitDate, setInitialVisitDate] = useState("");
  const [initialVisitService, setInitialVisitService] = useState("");
  const [initialVisitAmount, setInitialVisitAmount] = useState(0);
  const [initialVisitStaff, setInitialVisitStaff] = useState("");
  const [companionName, setCompanionName] = useState("");
  const [companionRelation, setCompanionRelation] = useState("");
  const [newCompanions, setNewCompanions] = useState<Array<{ name: string; relation?: string }>>([]);
  const [detail, setDetail] = useState<BackendCustomerDetail | null>(null);
  const [duplicate, setDuplicate] = useState<Awaited<ReturnType<typeof backendApi.lookupCustomer>>>(null);
  const [historyDate, setHistoryDate] = useState("");
  const [historyService, setHistoryService] = useState("");
  const [historyAmount, setHistoryAmount] = useState(0);
  const [historyStaff, setHistoryStaff] = useState("");
  const [detailCompanionName, setDetailCompanionName] = useState("");
  const [detailCompanionRelation, setDetailCompanionRelation] = useState("");
  const [loyaltyDelta, setLoyaltyDelta] = useState(0);
  const [loyaltyReason, setLoyaltyReason] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [directoryRows, setDirectoryRows] = useState<BackendCustomer[]>([]);
  const [directoryCounts, setDirectoryCounts] = useState<Record<CustomerDirectorySegment, number> | null>(null);
  const [directoryTotal, setDirectoryTotal] = useState(0);
  const [directoryHasMore, setDirectoryHasMore] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryLoadingMore, setDirectoryLoadingMore] = useState(false);
  const [directoryRefreshKey, setDirectoryRefreshKey] = useState(0);
  const canDeleteCustomer = ["OWNER", "ADMIN", "MANAGER"].includes(
    data.user?.role ?? "",
  );
  const customerQuery = customerSearchQuery.trim();
  const customerQueryDigits = customerQuery.replace(/\D/gu, "");
  const fallbackRows = data.customers
    .filter((customer) => {
      const matchesQuery = !customerQuery
        ? true
        : customerQueryDigits.length > 0
          ? (customer.phone ?? "").replace(/\D/gu, "").includes(customerQueryDigits)
          : customer.name.toLowerCase().includes(customerQuery.toLowerCase());
      return matchesQuery && (segment === "ALL" || customer.segments.includes(segment));
    })
    .sort((left, right) => {
      if (!customerQueryDigits) return left.name.localeCompare(right.name);
      const leftPhone = (left.phone ?? "").replace(/\D/gu, "");
      const rightPhone = (right.phone ?? "").replace(/\D/gu, "");
      return Number(rightPhone === customerQueryDigits) - Number(leftPhone === customerQueryDigits);
    });
  const fallbackCounts = Object.fromEntries(
    (["ALL", "NEW", "REPEAT", "AT_RISK", "LAPSED"] as CustomerDirectorySegment[]).map((key) => [
      key,
      key === "ALL"
        ? data.customers.length
        : data.customers.filter((customer) => customer.segments.includes(key))
            .length,
    ]),
  ) as Record<CustomerDirectorySegment, number>;
  const liveRows = directoryCounts ? directoryRows : fallbackRows;
  const counts = directoryCounts ?? fallbackCounts;
  const visibleTotal = directoryCounts ? directoryTotal : fallbackRows.length;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setDirectoryLoading(true);
    const timer = window.setTimeout(() => {
      backendApi
        .customerDirectory(token, {
          q: customerQuery,
          segment,
          take: CUSTOMER_DIRECTORY_PAGE_SIZE,
          skip: 0,
        })
        .then((result) => {
          if (cancelled) return;
          setDirectoryRows(result.customers);
          setDirectoryCounts(result.counts);
          setDirectoryTotal(result.total);
          setDirectoryHasMore(result.hasMore);
        })
        .catch(() => {
          if (cancelled) return;
          setDirectoryRows([]);
          setDirectoryCounts(null);
          setDirectoryTotal(0);
          setDirectoryHasMore(false);
        })
        .finally(() => {
          if (!cancelled) setDirectoryLoading(false);
        });
    }, customerQuery ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerQuery, directoryRefreshKey, segment, token]);

  const loadMoreCustomers = async () => {
    if (!token || directoryLoadingMore || !directoryHasMore) return;
    setDirectoryLoadingMore(true);
    setMessage("");
    try {
      const result = await backendApi.customerDirectory(token, {
        q: customerQuery,
        segment,
        take: CUSTOMER_DIRECTORY_PAGE_SIZE,
        skip: directoryRows.length,
      });
      setDirectoryRows((current) => {
        const seen = new Set(current.map((customer) => customer.id));
        return [
          ...current,
          ...result.customers.filter((customer) => !seen.has(customer.id)),
        ];
      });
      setDirectoryCounts(result.counts);
      setDirectoryTotal(result.total);
      setDirectoryHasMore(result.hasMore);
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "More customers could not be loaded.");
    } finally {
      setDirectoryLoadingMore(false);
    }
  };

  useEffect(() => {
    if (!token || phone.replace(/\D/g, "").length < 8) return;
    const timer = window.setTimeout(() => {
      backendApi.lookupCustomer(token, phone).then(setDuplicate).catch(() => setDuplicate(null));
    }, 350);
    return () => window.clearTimeout(timer);
  }, [phone, token]);

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
        source,
        referralName: source === "referral" ? referralName || undefined : undefined,
        referralPhone: source === "referral" ? referralPhone || undefined : undefined,
        waConsent,
        emailConsent,
        companions: newCompanions.length ? newCompanions : undefined,
        initialVisit: initialVisitDate && initialVisitService.trim() ? {
          visitedAt: new Date(`${initialVisitDate}T12:00:00`).toISOString(),
          serviceName: initialVisitService.trim(),
          amountMinor: Math.round(initialVisitAmount * 100),
          staffName: initialVisitStaff.trim() || undefined,
        } : undefined,
      });
      setName("");
      setPhone("");
      setEmail("");
      setSource("walk_in");
      setReferralName("");
      setReferralPhone("");
      setWaConsent(false);
      setEmailConsent(false);
      setInitialVisitDate(""); setInitialVisitService(""); setInitialVisitAmount(0); setInitialVisitStaff("");
      setNewCompanions([]); setCompanionName(""); setCompanionRelation("");
      setShowCreate(false);
      const loyalty = data.settings.loyalty as Record<string, unknown> | undefined;
      const welcomePoints = Number(loyalty?.welcomePoints ?? 50);
      setMessage(`Customer created with ${welcomePoints} welcome loyalty points.`);
      setDirectoryRefreshKey((current) => current + 1);
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
  const adjustLoyalty = async () => {
    if (!token || !detail || !loyaltyDelta || !loyaltyReason.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await backendApi.adjustLoyalty(token, detail.id, {
        deltaPoints: loyaltyDelta,
        reason: loyaltyReason.trim(),
      });
      setDetail(await backendApi.customerDetail(token, detail.id));
      setLoyaltyDelta(0);
      setLoyaltyReason("");
      setMessage(`Loyalty balance updated to ${result.balanceAfter} points.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Loyalty balance could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  const addHistory = async () => {
    if (!token || !detail || !historyDate || !historyService.trim()) return;
    setBusy(true); setMessage("");
    try {
      await backendApi.addCustomerHistory(token, detail.id, { visitedAt: new Date(historyDate).toISOString(), serviceName: historyService.trim(), amountMinor: historyAmount * 100, staffName: historyStaff.trim() || undefined });
      setDetail(await backendApi.customerDetail(token, detail.id));
      setHistoryDate(""); setHistoryService(""); setHistoryAmount(0); setHistoryStaff("");
      setMessage("Earlier visit added to this customer’s dated history."); onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "History could not be saved."); }
    finally { setBusy(false); }
  };
  const addCompanion = async () => {
    if (!token || !detail || !detailCompanionName.trim()) return;
    setBusy(true); setMessage("");
    try {
      await backendApi.addCustomerCompanion(token, detail.id, { name: detailCompanionName.trim(), relation: detailCompanionRelation.trim() || undefined });
      setDetail(await backendApi.customerDetail(token, detail.id));
      setDetailCompanionName(""); setDetailCompanionRelation("");
      setMessage("Family / group member added to this primary customer.");
    } catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Companion could not be saved."); }
    finally { setBusy(false); }
  };
  const deleteCustomer = async () => {
    if (!token || !detail || !canDeleteCustomer) return;
    const confirmed = window.confirm(
      `Delete ${detail.name} from the active customer list? Existing invoices, sales and visit history will remain preserved for audit.`,
    );
    if (!confirmed) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.deleteCustomer(token, detail.id);
      setDetail(null);
      setMessage(
        "Customer deleted from the active list. Historical invoices and sales remain preserved.",
      );
      setDirectoryRefreshKey((current) => current + 1);
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Customer could not be deleted.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="customers-view">
      {message && <div className="calendar-message">{message}</div>}
      <div className="crm-toolbar">
        <label className="crm-search admin-search-field">
          <span>⌕</span>
          <input
            value={customerSearchQuery}
            onChange={(event) => setCustomerSearchQuery(event.target.value)}
            onInput={(event) => setCustomerSearchQuery(event.currentTarget.value)}
            placeholder="Search phone number (recommended) or name…"
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
      <p className="customer-directory-status">
        {directoryLoading
          ? "Loading live customers…"
          : `Showing ${liveRows.length.toLocaleString("en-IN")} of ${visibleTotal.toLocaleString("en-IN")} customers`}
      </p>
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
              onChange={(event) => { setPhone(event.target.value); setDuplicate(null); }}
            />
          </label>
          {duplicate && <div className="duplicate-customer-alert"><strong>Existing customer found: {duplicate.name}</strong><span>{duplicate.visitCount} visits · {money(duplicate.totalSpent)} total · {duplicate.invoices.length + duplicate.historyEntries.length} recent records</span><button onClick={() => { setShowCreate(false); void open(duplicate.id); }}>Open customer history</button></div>}
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Customer source
            <select value={source} onChange={(event) => { setSource(event.target.value); if (event.target.value !== "referral") { setReferralName(""); setReferralPhone(""); } }}>
              <option value="walk_in">Walk-in</option>
              <option value="referral">Customer referral</option>
              <option value="google">Google / Maps</option>
              <option value="instagram">Instagram</option>
              <option value="facebook">Facebook</option>
              <option value="magicpin">Magicpin</option>
              <option value="other">Other</option>
            </select>
          </label>
          {source === "referral" && <>
            <label>Referred by<input value={referralName} onChange={(event) => setReferralName(event.target.value)} placeholder="Customer name" required /></label>
            <label>Referrer phone (optional)<input inputMode="tel" value={referralPhone} onChange={(event) => setReferralPhone(event.target.value)} placeholder="Phone number" /></label>
          </>}
          <div className="customer-family-create">
            <div><strong>Family / group members</strong><small>Keep one primary phone while recording who else visits under it.</small></div>
            <label>Member name<input value={companionName} onChange={(event) => setCompanionName(event.target.value)} placeholder="Child / spouse name" /></label>
            <label>Relation<input value={companionRelation} onChange={(event) => setCompanionRelation(event.target.value)} placeholder="Daughter, spouse, friend…" /></label>
            <button type="button" disabled={!companionName.trim()} onClick={() => { setNewCompanions((current) => [...current, { name: companionName.trim(), relation: companionRelation.trim() || undefined }]); setCompanionName(""); setCompanionRelation(""); }}>+ Add person</button>
            {newCompanions.map((companion, index) => <span key={`${companion.name}-${index}`}>{companion.name}{companion.relation ? ` · ${companion.relation}` : ""}<button type="button" aria-label={`Remove ${companion.name}`} onClick={() => setNewCompanions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>×</button></span>)}
          </div>
          <div className="historical-customer-create">
            <div className="historical-customer-heading">
              <strong>Customer since / historical visit</strong>
              <small>For an old register customer, add their first known visit date and service. Leave blank for a brand-new customer.</small>
            </div>
            <label>
              Customer since / first visit date (optional)
              <input type="date" max={new Date().toISOString().slice(0, 10)} value={initialVisitDate} onChange={(event) => setInitialVisitDate(event.target.value)} />
            </label>
            {initialVisitDate && <><label>Earlier service<input value={initialVisitService} onChange={(event) => setInitialVisitService(event.target.value)} placeholder="Haircut + colour" required /></label><label>Earlier sale (₹)<input type="number" min="0" value={initialVisitAmount || ""} placeholder="0" onChange={(event) => setInitialVisitAmount(Math.max(0, Number(event.target.value)))} /></label><label>Staff (optional)<input value={initialVisitStaff} onChange={(event) => setInitialVisitStaff(event.target.value)} /></label></>}
          </div>
          <fieldset>
            <legend>Communication consent</legend>
            <label><input type="checkbox" checked={waConsent} onChange={(event) => setWaConsent(event.target.checked)} />WhatsApp</label>
            <label><input type="checkbox" checked={emailConsent} onChange={(event) => setEmailConsent(event.target.checked)} />Email</label>
          </fieldset>
          <button
            className="button admin-primary"
            disabled={busy || !token || !name || Boolean(duplicate) || (source === "referral" && !referralName.trim()) || Boolean(initialVisitDate && !initialVisitService.trim())}
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
          <span>Points</span>
          <span>Total spend</span>
          <span>Last visit</span>
          <span />
        </header>
        {liveRows.map((customer) => (
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
                    <small>{customer.phone ?? customer.email ?? "No contact"} · {prettyStatus(customer.source ?? "walk_in")}{customer.referralName ? ` via ${customer.referralName}` : ""}</small>
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
                <strong>{customer.loyaltyPoints}</strong>
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
            ))}
        {!liveRows.length && (
          <p className="empty-cart">
            {directoryLoading
              ? "Loading live customers…"
              : "No customers match this phone, name or segment."}
          </p>
        )}
        {directoryHasMore && (
          <button
            type="button"
            className="button customer-load-more"
            disabled={directoryLoadingMore}
            onClick={() => void loadMoreCustomers()}
          >
            {directoryLoadingMore ? "Loading…" : "Load more customers"}
          </button>
        )}
      </article>
      {detail && (
        <section className="admin-card customer-360">
          <header>
            <div>
              <p className="eyebrow">Customer 360</p>
              <h2>{detail.name}</h2>
              <span>{detail.phone ?? detail.email ?? "No contact"} · {prettyStatus(detail.source ?? "walk_in")}{detail.referralName ? ` · referred by ${detail.referralName}${detail.referralPhone ? ` (${detail.referralPhone})` : ""}` : ""}</span>
            </div>
            <div className="customer-360-actions">
              {canDeleteCustomer && (
                <button
                  type="button"
                  className="customer-delete-button"
                  disabled={busy}
                  onClick={() => void deleteCustomer()}
                >
                  {busy ? "Working…" : "Delete customer"}
                </button>
              )}
              <button type="button" disabled={busy} onClick={() => setDetail(null)}>Close</button>
            </div>
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
              <small>Active packages</small>
              <strong>{detail.servicePackages?.length ?? 0}</strong>
            </span>
            <span>
              <small>Loyalty points</small>
              <strong>{detail.loyaltyPoints}</strong>
            </span>
          </div>
          <div className="loyalty-adjustment">
            <div><strong>Adjust loyalty balance</strong><small>Use a positive number to grant points or a negative number to correct them. Every change is audited.</small></div>
            <label>Points<input type="number" value={loyaltyDelta || ""} onChange={(event) => setLoyaltyDelta(Number(event.target.value))} placeholder="+100 or -50" /></label>
            <label>Reason<input value={loyaltyReason} onChange={(event) => setLoyaltyReason(event.target.value)} placeholder="Service recovery / correction" /></label>
            <button className="button admin-primary" disabled={busy || !loyaltyDelta || !loyaltyReason.trim()} onClick={() => void adjustLoyalty()}>Save adjustment</button>
          </div>
          <div className="history-import-form">
            <div><strong>Add earlier salon visit</strong><small>Use this for dated records from the previous system. It updates customer search and retention history without creating a fake invoice.</small></div>
            <label>Visit date<input type="date" max={new Date().toISOString().slice(0, 10)} value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} /></label>
            <label>Service<input value={historyService} onChange={(event) => setHistoryService(event.target.value)} placeholder="Hair colour + cut" /></label>
            <label>Sale amount (₹)<input type="number" min="0" value={historyAmount || ""} placeholder="0" onChange={(event) => setHistoryAmount(Number(event.target.value))} /></label>
            <label>Staff (optional)<input value={historyStaff} onChange={(event) => setHistoryStaff(event.target.value)} /></label>
            <button className="button admin-primary" disabled={busy || !historyDate || !historyService.trim()} onClick={() => void addHistory()}>Add dated visit</button>
          </div>
          <div className="customer-companion-manager">
            <div><strong>Family / group profile</strong><small>Assign individual services to these people from POS while retaining one primary phone number.</small></div>
            <label>Name<input value={detailCompanionName} onChange={(event) => setDetailCompanionName(event.target.value)} placeholder="Family member name" /></label>
            <label>Relation<input value={detailCompanionRelation} onChange={(event) => setDetailCompanionRelation(event.target.value)} placeholder="Relation (optional)" /></label>
            <button className="button admin-primary" disabled={busy || !detailCompanionName.trim()} onClick={() => void addCompanion()}>Add person</button>
            <section>{detail.companions.map((companion) => <article key={companion.id}><strong>{companion.name}</strong><small>{companion.relation ?? "Group member"} · {companion.visitCount} visits{companion.lastVisitAt ? ` · last ${new Date(companion.lastVisitAt).toLocaleDateString("en-IN")}` : ""}</small></article>)}{!detail.companions.length && <p>No linked family or group members yet.</p>}</section>
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
              ...(detail.servicePackages ?? []).flatMap((customerPackage) =>
                customerPackage.ledger.map((entry) => ({
                  key: `p-${entry.id}`,
                  at: entry.createdAt,
                  title: `${customerPackage.package.name} · ${entry.service.name}`,
                  meta: `${prettyStatus(entry.type)} · ${entry.qtyDelta > 0 ? "+" : ""}${entry.qtyDelta} · balance ${entry.balanceAfter}`,
                })),
              ),
              ...(detail.loyaltyLedger ?? []).map((entry) => ({
                key: `l-${entry.id}`,
                at: entry.createdAt,
                title: `Loyalty · ${entry.deltaPoints > 0 ? "+" : ""}${entry.deltaPoints} points`,
                meta: `${prettyStatus(entry.type)} · balance ${entry.balanceAfter} · ${entry.reason}`,
              })),
              ...(detail.historyEntries ?? []).map((entry) => ({
                key: `h-${entry.id}`,
                at: entry.visitedAt,
                title: `${entry.serviceName} · ${money(entry.amountMinor)}`,
                meta: `Imported history${entry.staffName ? ` · ${entry.staffName}` : ""}`,
              })),
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
              !detail.memberships.length &&
              !(detail.servicePackages?.length ?? 0) && (
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
  const [planName, setPlanName] = useState("");
  const [planPay, setPlanPay] = useState(3000);
  const [planCredit, setPlanCredit] = useState(5000);
  const [planValidity, setPlanValidity] = useState(180);
  const [packageName, setPackageName] = useState("");
  const [packagePrice, setPackagePrice] = useState(1999);
  const [packageValidity, setPackageValidity] = useState(90);
  const [packageItems, setPackageItems] = useState<Record<string, number>>({});
  const [packageId, setPackageId] = useState("");
  const [soldByStaffId, setSoldByStaffId] = useState("");
  const services = data.categories.flatMap((category) => category.services);
  const enroll = async () => {
    if (!token || !customerId || !planId) return;
    setBusy(true);
    setMessage("");
    try {
      const membership = await backendApi.enrollMembership(token, {
        customerId,
        planId,
        soldByStaffId: soldByStaffId || undefined,
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
  const createPlan = async () => {
    if (!token || !planName || planCredit <= 0 || planPay < 0) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createMembershipPlan(token, {
        name: planName,
        payMinor: planPay * 100,
        creditMinor: planCredit * 100,
        validityDays: planValidity > 0 ? planValidity : null,
      });
      setPlanName("");
      setMessage("Membership plan created and available for enrolment.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Plan could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const createPackage = async () => {
    const items = Object.entries(packageItems)
      .filter(([, qty]) => qty > 0)
      .map(([serviceId, qty]) => ({ serviceId, qty }));
    if (!token || !packageName || !items.length) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createServicePackage(token, {
        name: packageName,
        priceMinor: packagePrice * 100,
        validityDays: packageValidity > 0 ? packageValidity : null,
        items,
      });
      setPackageName("");
      setPackageItems({});
      setMessage("Service package created with ledger-backed visit balances.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Package could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const enrollPackage = async () => {
    if (!token || !customerId || !packageId) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.enrollServicePackage(token, { customerId, packageId, soldByStaffId: soldByStaffId || undefined });
      setMessage("Service package assigned; every included service was added to its immutable ledger.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Package could not be assigned.");
    } finally {
      setBusy(false);
    }
  };
  const activePlans = plans;
  return (
    <div>
      {message && <div className="calendar-message">{message}</div>}
      <div className="membership-builder-grid">
        <section className="admin-card phase-one-form compact-builder">
          <div>
            <p className="eyebrow">Credit membership</p>
            <h2>Create membership plan</h2>
          </div>
          <label>Name<input value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="Premium membership" /></label>
          <label>Customer pays (₹)<input type="number" min="0" value={planPay} onChange={(event) => setPlanPay(Number(event.target.value))} /></label>
          <label>Service credit (₹)<input type="number" min="1" value={planCredit} onChange={(event) => setPlanCredit(Number(event.target.value))} /></label>
          <label>Validity days<input type="number" min="0" value={planValidity} onChange={(event) => setPlanValidity(Number(event.target.value))} /></label>
          <button className="button admin-primary" disabled={busy || !token || !planName} onClick={() => void createPlan()}>{busy ? "Saving…" : "Create membership"}</button>
        </section>
        <section className="admin-card phase-one-form compact-builder package-builder">
          <div>
            <p className="eyebrow">Prepaid services</p>
            <h2>Create service package</h2>
          </div>
          <label>Name<input value={packageName} onChange={(event) => setPackageName(event.target.value)} placeholder="Hair care bundle" /></label>
          <label>Package price (₹)<input type="number" min="0" value={packagePrice} onChange={(event) => setPackagePrice(Number(event.target.value))} /></label>
          <label>Validity days<input type="number" min="0" value={packageValidity} onChange={(event) => setPackageValidity(Number(event.target.value))} /></label>
          <fieldset>
            <legend>Included services and quantity</legend>
            {services.map((service) => (
              <label key={service.id}>
                <span>{service.name}</span>
                <input type="number" min="0" max="100" value={packageItems[service.id] ?? 0} onChange={(event) => setPackageItems((current) => ({ ...current, [service.id]: Number(event.target.value) }))} />
              </label>
            ))}
          </fieldset>
          <button className="button admin-primary" disabled={busy || !token || !packageName || !Object.values(packageItems).some((qty) => qty > 0)} onClick={() => void createPackage()}>{busy ? "Saving…" : "Create package"}</button>
        </section>
      </div>
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
        <label>Sold by<select value={soldByStaffId} onChange={(event) => setSoldByStaffId(event.target.value)}><option value="">Front desk / no staff attribution</option>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName} · {staff.designation ?? "Staff"}</option>)}</select></label>
        <button
          className="button admin-primary"
          disabled={busy || !token || !customerId || !planId}
          onClick={() => void enroll()}
        >
          {busy ? "Activating…" : "Activate plan"}
        </button>
        <label>
          Service package
          <select value={packageId} onChange={(event) => setPackageId(event.target.value)}>
            <option value="">Select package</option>
            {data.servicePackages.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.priceMinor)}</option>)}
          </select>
        </label>
        <button className="button" disabled={busy || !token || !customerId || !packageId} onClick={() => void enrollPackage()}>
          {busy ? "Assigning…" : "Assign package"}
        </button>
      </section>
      <div className="membership-metrics">
        <article>
          <span>Active plans</span>
          <strong>{activePlans.length}</strong>
          <small>{plans.length ? "Live from backend" : "No plans created yet"}</small>
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
            <span className="plan-ready">Available for enrolment</span>
          </article>
        ))}
      </div>
      <div className="membership-plan-grid package-plan-grid">
        {data.servicePackages.map((item) => (
          <article className="admin-card plan-card" key={item.id}>
            <p className="eyebrow">Service package</p>
            <h2>{item.name}</h2>
            <strong className="package-price">{money(item.priceMinor)}</strong>
            <ul>
              {item.items.map((entry) => <li key={entry.id}>{entry.qty} × {entry.service.name}</li>)}
            </ul>
            <p>{item.validityDays ? `Valid for ${item.validityDays} days` : "No expiry"}</p>
          </article>
        ))}
      </div>
    </div>
  );
}

function Coupons({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<"PERCENTAGE" | "FIXED">("PERCENTAGE");
  const [value, setValue] = useState(10);
  const [minSpend, setMinSpend] = useState(0);
  const [maxDiscount, setMaxDiscount] = useState("");
  const [usageLimit, setUsageLimit] = useState("");
  const [perCustomerLimit, setPerCustomerLimit] = useState("1");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const create = async () => {
    if (!token || !code.trim() || !name.trim() || value <= 0) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createCoupon(token, {
        branchId: "main",
        code: code.trim().toUpperCase(),
        name: name.trim(),
        type,
        value: type === "PERCENTAGE" ? Math.round(value * 100) : Math.round(value * 100),
        minSpendMinor: Math.round(minSpend * 100),
        maxDiscountMinor: maxDiscount ? Math.round(Number(maxDiscount) * 100) : null,
        usageLimit: usageLimit ? Number(usageLimit) : null,
        perCustomerLimit: perCustomerLimit ? Number(perCustomerLimit) : null,
        startsAt: startsAt ? new Date(`${startsAt}T00:00:00`).toISOString() : null,
        endsAt: endsAt ? new Date(`${endsAt}T23:59:59`).toISOString() : null,
        isActive: true,
      });
      setCode("");
      setName("");
      setMessage("Coupon created and ready at POS.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Coupon could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (id: string, isActive: boolean) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateCoupon(token, id, { isActive });
      setMessage(`Coupon ${isActive ? "activated" : "paused"}.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Coupon could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="coupon-admin">
      {message && <div className="calendar-message">{message}</div>}
      <section className="admin-card phase-one-form coupon-builder">
        <div>
          <p className="eyebrow">POS offers</p>
          <h2>Create coupon</h2>
          <small>Percentage and fixed-value coupons are validated again by the backend at checkout.</small>
        </div>
        <label>Code<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="WELCOME10" /></label>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Welcome offer" /></label>
        <label>Type<select value={type} onChange={(event) => setType(event.target.value as "PERCENTAGE" | "FIXED")}><option value="PERCENTAGE">Percentage</option><option value="FIXED">Fixed amount</option></select></label>
        <label>{type === "PERCENTAGE" ? "Discount (%)" : "Discount (₹)"}<input type="number" min="1" max={type === "PERCENTAGE" ? 100 : undefined} value={value} onChange={(event) => setValue(Number(event.target.value))} /></label>
        <label>Minimum spend (₹)<input type="number" min="0" value={minSpend} onChange={(event) => setMinSpend(Number(event.target.value))} /></label>
        <label>Max discount (₹)<input type="number" min="1" value={maxDiscount} onChange={(event) => setMaxDiscount(event.target.value)} placeholder="No cap" /></label>
        <label>Total uses<input type="number" min="1" value={usageLimit} onChange={(event) => setUsageLimit(event.target.value)} placeholder="Unlimited" /></label>
        <label>Uses / customer<input type="number" min="1" value={perCustomerLimit} onChange={(event) => setPerCustomerLimit(event.target.value)} placeholder="Unlimited" /></label>
        <label>Starts<input type="date" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label>
        <label>Ends<input type="date" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /></label>
        <button className="button admin-primary" disabled={busy || !token || !code || !name || value <= 0} onClick={() => void create()}>{busy ? "Saving…" : "Create coupon"}</button>
      </section>
      <div className="coupon-grid">
        {data.coupons.map((coupon) => (
          <article className="admin-card coupon-card" key={coupon.id}>
            <header><div><strong>{coupon.code}</strong><small>{coupon.name}</small></div><span className={coupon.isActive ? "active" : "paused"}>{coupon.isActive ? "Active" : "Paused"}</span></header>
            <b>{coupon.type === "PERCENTAGE" ? `${coupon.value / 100}% off` : `${money(coupon.value)} off`}</b>
            <p>Minimum {money(coupon.minSpendMinor)} · used {coupon.usedCount}{coupon.usageLimit ? ` / ${coupon.usageLimit}` : ""}</p>
            <small>{coupon.perCustomerLimit ? `${coupon.perCustomerLimit} use(s) per customer` : "No customer limit"}{coupon.endsAt ? ` · ends ${new Date(coupon.endsAt).toLocaleDateString("en-IN")}` : ""}</small>
            <button disabled={busy} onClick={() => void toggle(coupon.id, !coupon.isActive)}>{coupon.isActive ? "Pause" : "Activate"}</button>
          </article>
        ))}
        {!data.coupons.length && <p className="empty-cart">No coupons yet. Create the first POS offer above.</p>}
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
  const [categoryName, setCategoryName] = useState("");
  const [categoryGender, setCategoryGender] = useState("Unisex");
  const [parentCategoryId, setParentCategoryId] = useState("");
  const [name, setName] = useState("");
  const [duration, setDuration] = useState(60);
  const [price, setPrice] = useState(799);
  const [staffIds, setStaffIds] = useState<string[]>([]);
  const [editingServiceId, setEditingServiceId] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const resetServiceForm = () => {
    setEditingServiceId("");
    setName("");
    setDuration(60);
    setPrice(799);
    setStaffIds([]);
  };
  const startEditService = (service: BackendService, nextCategoryId: string) => {
    setEditingServiceId(service.id);
    setCategoryId(nextCategoryId);
    setName(service.name);
    setDuration(service.durationMin);
    setPrice(Math.round(service.priceMinor / 100));
    setStaffIds(service.serviceStaff.map((entry) => entry.staff.id));
    setMessage("Editing service. Save changes or cancel to create a new service.");
  };
  const createCategory = async () => {
    if (!token || !categoryName.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const category = await backendApi.createServiceCategory(token, {
        name: categoryName.trim(),
        gender: categoryGender,
        parentId: parentCategoryId || null,
        sortOrder: data.categories.length * 10,
      });
      setCategoryName("");
      setParentCategoryId("");
      setCategoryId(category.id);
      setMessage(parentCategoryId ? "Subcategory created. Add its first service below." : "Main category created. Add its first service below.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Category could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const saveService = async () => {
    if (!token || !categoryId || !name || !staffIds.length) return;
    setBusy(true);
    setMessage("");
    try {
      const payload = {
        categoryId,
        name,
        durationMin: duration,
        bufferMin: 5,
        priceMinor: price * 100,
        taxRateBps: 0,
        staffIds,
      };
      if (editingServiceId) {
        await backendApi.updateService(token, editingServiceId, payload);
      } else {
        await backendApi.createService(token, payload);
      }
      resetServiceForm();
      setMessage(
        editingServiceId
          ? "Service updated and POS now uses the new details."
          : "Service created and immediately available to eligible artists.",
      );
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Service could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const deleteService = async (service: BackendService) => {
    if (!token) return;
    if (!window.confirm(`Delete "${service.name}" from POS and booking? Existing invoices will stay safe.`)) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.deleteService(token, service.id);
      if (editingServiceId === service.id) resetServiceForm();
      setMessage("Service deleted from active catalogue. Old bills remain unchanged.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Service could not be deleted.");
    } finally {
      setBusy(false);
    }
  };
  const topLevelCategories = data.categories.filter((category) => !category.parentId);
  const categoryTree = topLevelCategories
    .map((parent) => ({
      parent,
      children: data.categories.filter((category) => category.parentId === parent.id),
      directServices: parent.services,
    }))
    .sort((a, b) => a.parent.sortOrder - b.parent.sortOrder || a.parent.name.localeCompare(b.parent.name));
  const orphanCategories = data.categories.filter((category) => category.parentId && !data.categories.some((parent) => parent.id === category.parentId));
  return (
    <div className="services-admin">
      {message && <div className="calendar-message">{message}</div>}
      <section className="admin-card phase-one-form category-create">
        <div><p className="eyebrow">Category manager</p><h2>Create category</h2><small>Create parent categories like Men/Women/Hair, then subcategories like Hair & Grooming, Facials or Waxing.</small></div>
        <label>Category name<input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Pedicure" /></label>
        <label>Parent category<select value={parentCategoryId} onChange={(event) => setParentCategoryId(event.target.value)}><option value="">No parent · main category</option>{topLevelCategories.map((category) => <option value={category.id} key={category.id}>{category.name}</option>)}</select></label>
        <label>Audience<select value={categoryGender} onChange={(event) => setCategoryGender(event.target.value)}><option value="Unisex">Unisex</option><option value="Male">Male</option><option value="Female">Female</option><option value="Kids - Unisex">Kids · Unisex</option><option value="Boys">Boys</option><option value="Girls">Girls</option><option value="Baby Boy">Baby boy</option><option value="Baby Girl">Baby girl</option></select></label>
        <button className="button admin-primary" disabled={busy || !token || !categoryName.trim()} onClick={() => void createCategory()}>{busy ? "Creating…" : "Create category"}</button>
      </section>
      <section className="admin-card phase-one-form service-create">
        <div>
          <p className="eyebrow">Bookable catalogue</p>
          <h2>{editingServiceId ? "Edit service" : "Create service"}</h2>
          <small>
            Duration, price and eligible artists feed both public booking and
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
                {categoryDisplayName(category)}
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
          onClick={() => void saveService()}
        >
          {busy ? "Saving…" : editingServiceId ? "Save service" : "Create service"}
        </button>
        {editingServiceId && <button className="button" disabled={busy} onClick={resetServiceForm}>Cancel edit</button>}
      </section>
      <div className="service-admin-grid">
        {[...categoryTree, ...orphanCategories.map((category) => ({ parent: category, children: [], directServices: category.services }))].map(({ parent, children, directServices }) => (
          <article className="admin-card service-category-card" key={parent.id}>
            <header>
              <div><h3>{parent.name}</h3><small>{parent.gender ?? "All audiences"} · {children.length ? `${children.length} subcategories` : "Main category"}</small></div>
              <span>{directServices.length + children.reduce((sum, child) => sum + child.services.length, 0)}</span>
            </header>
            {directServices.map((service) => (
              <div key={service.id} className="service-row">
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
                <div className="service-row-actions">
                  <button disabled={busy} onClick={() => startEditService(service, parent.id)}>Edit</button>
                  <button className="danger" disabled={busy} onClick={() => void deleteService(service)}>Delete</button>
                </div>
              </div>
            ))}
            {children.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name)).map((category) => (
              <section className="subcategory-block" key={category.id}>
                <h4>{category.name}<small>{category.gender ?? parent.gender ?? "All audiences"}</small></h4>
                {category.services.map((service) => (
                  <div key={service.id} className="service-row">
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
                    <div className="service-row-actions">
                      <button disabled={busy} onClick={() => startEditService(service, category.id)}>Edit</button>
                      <button className="danger" disabled={busy} onClick={() => void deleteService(service)}>Delete</button>
                    </div>
                  </div>
                ))}
                {!category.services.length && <p className="empty-cart">No services in this subcategory yet.</p>}
              </section>
            ))}
          </article>
        ))}
      </div>
    </div>
  );
}

function Cashbook({ token, data, onRefresh }: { token: string; data: BackendSnapshot; onRefresh: () => void }) {
  const [openingBreakdown, setOpeningBreakdown] = useState<CashBreakdown>(emptyCashBreakdown);
  const [closingBreakdown, setClosingBreakdown] = useState<CashBreakdown>(emptyCashBreakdown);
  const [closingManualAmount, setClosingManualAmount] = useState("");
  const [openingConfirmation, setOpeningConfirmation] = useState(0);
  const [openingCountAcknowledged, setOpeningCountAcknowledged] = useState(false);
  const [category, setCategory] = useState("Refreshments");
  const [description, setDescription] = useState("");
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "UPI" | "CARD">("CASH");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const session = data.currentCash;
  const openingCashMinor = cashBreakdownTotalMinor(openingBreakdown);
  const closingCashMinor = cashBreakdownTotalMinor(closingBreakdown);
  const closingManualMinor =
    closingManualAmount.trim() === "" ? null : Math.max(0, Math.round(Number(closingManualAmount) * 100));
  const effectiveClosingCashMinor = closingManualMinor ?? closingCashMinor;
  const closingMode = closingManualMinor === null ? "count" : "manual";
  const openingCountConfirmed = openingCountAcknowledged && Math.round(openingConfirmation * 100) === openingCashMinor;
  const closingCountMatches = Boolean(session && effectiveClosingCashMinor === session.expectedCashMinor);
  const operate = async (action: "open" | "close" | "expense") => {
    if (!token) return;
    setBusy(true); setMessage("");
    try {
      if (action === "open") {
        await backendApi.openCashSession(token, { branchId: "main", openingCashMinor, openingBreakdown });
        setOpeningBreakdown(emptyCashBreakdown()); setOpeningConfirmation(0); setOpeningCountAcknowledged(false); setMessage("Cash drawer opened. Every cash sale and expense now reconciles against it.");
      } else if (action === "close" && session) {
        const result = await backendApi.closeCashSession(token, session.id, {
          closingCashMinor: effectiveClosingCashMinor,
          closingBreakdown: closingMode === "manual" ? null : closingBreakdown,
        });
        setClosingBreakdown(emptyCashBreakdown()); setClosingManualAmount(""); setMessage(`Drawer closed. Variance: ${money(result.varianceMinor ?? 0)}.`);
      } else if (action === "expense") {
        await backendApi.createExpense(token, { branchId: "main", category, description, amountMinor: amount * 100, paymentMethod });
        setDescription(""); setAmount(0); setMessage("Expense recorded in the audit trail.");
      }
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Cashbook action failed.");
    } finally { setBusy(false); }
  };
  return <div className="cashbook-view">
    {message && <div className="calendar-message">{message}</div>}
    <section className="cashbook-kpis">
      <article><small>Opening cash</small><strong>{money(session?.openingCashMinor ?? 0)}</strong><span>{session ? `Opened ${new Date(session.openedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}` : "No open drawer"}</span></article>
      <article><small>Cash sales</small><strong>{money(session?.cashSalesMinor ?? 0)}</strong><span>Paid invoices since opening</span></article>
      <article><small>UPI sales</small><strong>{money(session?.upiSalesMinor ?? 0)}</strong><span>Does not change drawer cash</span></article>
      <article><small>Card sales</small><strong>{money(session?.cardSalesMinor ?? 0)}</strong><span>Does not change drawer cash</span></article>
      <article><small>Cash expenses</small><strong>{money(session?.cashExpensesMinor ?? 0)}</strong><span>Recorded against this drawer</span></article>
      <article className="expected"><small>Expected cash</small><strong>{money(session?.expectedCashMinor ?? 0)}</strong><span>Opening + sales − expenses</span></article>
    </section>
    <div className="cashbook-grid">
      <section className="admin-card phase-one-form">
        <div><p className="eyebrow">Daily register</p><h2>{session ? "Close cash drawer" : "Open cash drawer"}</h2><small>{session ? `Business date ${session.businessDate}` : "Enter the physical cash available before the first sale."}</small></div>
        {!session ? <><CashDenominationCounter value={openingBreakdown} onChange={setOpeningBreakdown} title="Opening coins and notes" /><label>Re-enter counted total to confirm (₹)<input type="number" min="0" value={openingConfirmation || ""} placeholder="0" onChange={(event) => setOpeningConfirmation(Math.max(0, Number(event.target.value)))} /></label><label className="consent-box"><input type="checkbox" checked={openingCountAcknowledged} onChange={(event) => setOpeningCountAcknowledged(event.target.checked)} /><span>I physically counted every coin and note</span></label>{!openingCountConfirmed && <p className="cash-mismatch-message">Enter {money(openingCashMinor)} and confirm the physical count.</p>}</> : <><CashDenominationCounter value={closingBreakdown} onChange={setClosingBreakdown} expectedMinor={session.expectedCashMinor} title="Closing coins and notes" /><div className="manual-cash-total"><label>Closing cash amount (₹)<input type="number" min="0" inputMode="decimal" value={closingManualAmount} placeholder={`${(session.expectedCashMinor / 100).toLocaleString("en-IN")}`} onChange={(event) => setClosingManualAmount(event.target.value)} /></label><small>Use this if you counted total cash directly. Leave blank to use the note/coin count above.</small><strong className={closingCountMatches ? "matches" : "mismatch"}>{closingMode === "manual" ? "Manual total" : "Denomination total"}: {money(effectiveClosingCashMinor)}</strong></div>{!closingCountMatches && <p className="cash-mismatch-message">Counted {money(effectiveClosingCashMinor)} · expected {money(session.expectedCashMinor)} · fix the amount or record the missing cash expense before closing.</p>}</>}
        <button className="button admin-primary" disabled={busy || !token || (session ? !closingCountMatches : !openingCountConfirmed)} onClick={() => void operate(session ? "close" : "open")}>{busy ? "Saving…" : session ? "Close & reconcile" : "Open drawer"}</button>
      </section>
      <section className="admin-card phase-one-form">
        <div><p className="eyebrow">Operating expense</p><h2>Add daily expense</h2><small>Milk, refreshments, supplies, travel and other salon expenses.</small></div>
        <label>Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option>Refreshments</option><option>Consumables</option><option>Utilities</option><option>Travel</option><option>Maintenance</option><option>Other</option></select></label>
        <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Milk and tea supplies" /></label>
        <label>Amount (₹)<input type="number" min="1" value={amount || ""} placeholder="0" onChange={(event) => setAmount(Number(event.target.value))} /></label>
        <label>Paid via<select value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value as typeof paymentMethod)}><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="CARD">Card</option></select></label>
        <button className="button admin-primary" disabled={busy || !token || !description.trim() || amount <= 0 || (paymentMethod === "CASH" && !session)} onClick={() => void operate("expense")}>Record expense</button>
      </section>
    </div>
    <article className="admin-card expense-list"><div className="card-head"><div><h2>Recent expenses</h2><p>Latest branch expenses with payment method.</p></div></div>{data.expenses.slice(0, 12).map((expense) => <div key={expense.id}><span><strong>{expense.description}</strong><small>{expense.category} · {new Date(expense.occurredAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></span><em>{prettyStatus(expense.paymentMethod)}</em><b>{money(expense.amountMinor)}</b></div>)}{!data.expenses.length && <p className="empty-cart">No expenses recorded yet.</p>}</article>
  </div>;
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
  const [productName, setProductName] = useState("");
  const [productSku, setProductSku] = useState("");
  const [productPrice, setProductPrice] = useState(499);
  const [productMrp, setProductMrp] = useState(599);
  const [productPurchase, setProductPurchase] = useState(300);
  const [productDiscount, setProductDiscount] = useState(0);
  const [productCommission, setProductCommission] = useState(0);
  const [reorderLevel, setReorderLevel] = useState(5);
  const [movementProductId, setMovementProductId] = useState("");
  const [movementQty, setMovementQty] = useState(1);
  const [movementReason, setMovementReason] = useState<
    "PURCHASE" | "CONSUMPTION" | "WASTAGE" | "ADJUSTMENT"
  >("PURCHASE");
  const rows = data.products;
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
  const createProduct = async () => {
    if (!token || !productName) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.createProduct(token, {
        name: productName,
        sku: productSku || undefined,
        sellMinor: productPrice * 100,
        mrpMinor: productMrp * 100,
        purchaseMinor: productPurchase * 100,
        discountBps: Math.round(productDiscount * 100),
        commissionBps: Math.round(productCommission * 100),
        taxRateBps: 1800,
        reorderLevel,
      });
      setProductName("");
      setProductSku("");
      setMessage("Product created and available in POS.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Product could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const moveStock = async () => {
    if (!token || !movementProductId || movementQty === 0) return;
    setBusy(true);
    setMessage("");
    try {
      const signedQty = movementReason === "PURCHASE" || (movementReason === "ADJUSTMENT" && movementQty > 0)
        ? Math.abs(movementQty)
        : -Math.abs(movementQty);
      const result = await backendApi.moveProductStock(token, movementProductId, { qtyDelta: signedQty, reason: movementReason });
      setMessage(`Stock movement saved. New balance: ${result.stockAfter}.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Stock movement failed.");
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
          <small>{data.products.length ? "Live stock catalog" : "No stock records yet"}</small>
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
      <div className="inventory-ops-grid inventory-quick-actions">
        <section className="admin-card phase-one-form compact-builder">
          <div><p className="eyebrow">POS catalog</p><h2>Add product</h2></div>
          <label>Name<input value={productName} onChange={(event) => setProductName(event.target.value)} /></label>
          <label>SKU<input value={productSku} onChange={(event) => setProductSku(event.target.value)} /></label>
          <label>Sell price (₹)<input type="number" min="0" value={productPrice} onChange={(event) => setProductPrice(Number(event.target.value))} /></label>
          <label>MRP (₹)<input type="number" min="0" value={productMrp} onChange={(event) => setProductMrp(Number(event.target.value))} /></label>
          <label>Purchase price (₹)<input type="number" min="0" value={productPurchase} onChange={(event) => setProductPurchase(Number(event.target.value))} /></label>
          <label>Discount %<input type="number" min="0" max="100" value={productDiscount} onChange={(event) => setProductDiscount(Number(event.target.value))} /></label>
          <label>Staff commission %<input type="number" min="0" max="100" value={productCommission} onChange={(event) => setProductCommission(Number(event.target.value))} /></label>
          <label>Reorder level<input type="number" min="0" value={reorderLevel} onChange={(event) => setReorderLevel(Number(event.target.value))} /></label>
          <button className="button admin-primary" disabled={busy || !token || !productName} onClick={() => void createProduct()}>{busy ? "Saving…" : "Add product"}</button>
        </section>
        <section className="admin-card phase-one-form compact-builder">
          <div><p className="eyebrow">Append-only stock</p><h2>Record movement</h2></div>
          <label>Product<select value={movementProductId} onChange={(event) => setMovementProductId(event.target.value)}><option value="">Select product</option>{data.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.stockQty}</option>)}</select></label>
          <label>Reason<select value={movementReason} onChange={(event) => setMovementReason(event.target.value as typeof movementReason)}><option value="PURCHASE">Purchase</option><option value="CONSUMPTION">Salon consumption</option><option value="WASTAGE">Wastage</option><option value="ADJUSTMENT">Positive adjustment</option></select></label>
          <label>Quantity<input type="number" min="1" value={movementQty} onChange={(event) => setMovementQty(Number(event.target.value))} /></label>
          <button className="button admin-primary" disabled={busy || !token || !movementProductId || movementQty <= 0} onClick={() => void moveStock()}>{busy ? "Saving…" : "Record stock"}</button>
        </section>
      </div>
      <article className="admin-card inventory-table">
        <header>
          <span>Product</span>
          <span>SKU</span>
          <span>Stock</span>
          <span>Reorder at</span>
          <span>Sell price</span>
          <span>MRP / discount</span>
          <span>Commission</span>
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
            <span>{money(product.mrpMinor)} · {product.discountBps / 100}%</span>
            <span>{product.commissionBps / 100}%</span>
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
  const [newCustomerId, setNewCustomerId] = useState("");
  const [officialTemplates, setOfficialTemplates] = useState<BackendWhatsAppTemplate[]>([]);
  const [templateMode, setTemplateMode] = useState<"text" | "template">("text");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [inboxSearch, setInboxSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [newChannel, setNewChannel] = useState<
    "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL"
  >("WHATSAPP_OFFICIAL");
  const selected =
    data.conversations.find((item) => item.id === selectedId) ??
    data.conversations[0];
  const canUseTemplate = selected?.channel.type === "WHATSAPP_OFFICIAL";
  const activeTemplate = officialTemplates.find((template) => template.id === selectedTemplateId);
  const sendDisabled = (() => {
    if (!selected) return true;
    if (internal) return !body.trim();
    if (canUseTemplate && templateMode === "template") return !activeTemplate;
    return !body.trim();
  })();
  const conversationRows = data.conversations.filter((item) => (!unreadOnly || item.unread) && (!inboxSearch.trim() || (item.customer?.name ?? "").toLowerCase().includes(inboxSearch.toLowerCase()) || (item.customer?.phone ?? "").includes(inboxSearch.replace(/\D/g, ""))));
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
  useEffect(() => {
    if (!token || !selected?.id) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await backendApi.conversation(token, selected.id);
        if (!cancelled) setDetail(next);
      } catch {
        // Keep the last successful thread visible while a provider reconnects.
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 8_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [selected?.id, token]);
  useEffect(() => {
    if (!token) return;
    const timer = window.setInterval(onRefresh, 15_000);
    return () => window.clearInterval(timer);
  }, [onRefresh, token]);
  useEffect(() => {
    if (!token || !canUseTemplate) {
      return;
    }
    let cancelled = false;
    const syncTemplates = async () => {
      try {
        const next = await backendApi.whatsappStatus(token);
        if (!cancelled) {
          const templates = next.official.templates ?? [];
          if (!templates.length && templateMode === "template") {
            setTemplateMode("text");
          }
          setOfficialTemplates(templates);
          if (templateMode === "template" && templates.length && !templates.find((template) => template.id === selectedTemplateId)) {
            setSelectedTemplateId(templates[0].id);
          }
        }
      } catch {
        if (!cancelled) {
          setOfficialTemplates([]);
          setTemplateMode("text");
          setSelectedTemplateId("");
        }
      }
    };
    void syncTemplates();
    const timer = window.setInterval(syncTemplates, 25_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [canUseTemplate, selected?.id, templateMode, token, selectedTemplateId]);
  const send = async () => {
    if (!token || !selected || sendDisabled) return;
    setBusy(true);
    setMessage("");
    try {
      const basePayload = {
        body: body.trim(),
        internal,
      } as Parameters<typeof backendApi.sendConversationMessage>[2];
      if (!internal && canUseTemplate && templateMode === "template" && activeTemplate) {
        const templatePayload = {
          internal: false,
          templateName: activeTemplate.name,
          templateLanguage: activeTemplate.language,
        } as Parameters<typeof backendApi.sendConversationMessage>[2];
        if (!body.trim()) delete templatePayload.body;
        await backendApi.sendConversationMessage(token, selected.id, templatePayload);
      } else {
        await backendApi.sendConversationMessage(token, selected.id, {
          ...basePayload,
        });
      }
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

  const sendRateList = async () => {
    if (!token || !selected) return;
    setBusy(true);
    setMessage("");
    try {
      const rateList = buildRateListMessage(data.categories, selected.customer?.name);
      await backendApi.sendConversationMessage(token, selected.id, {
        body: rateList,
        internal: false,
      });
      setBody("");
      setDetail(await backendApi.conversation(token, selected.id));
      setMessage("Rate list sent through the configured provider.");
      onRefresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? prettyStatus(cause.message)
          : "Rate list could not be sent.",
      );
    } finally {
      setBusy(false);
    }
  };

  const startConversation = async () => {
    if (!token || !newCustomerId) return;
    setBusy(true);
    setMessage("");
    try {
      const conversation = await backendApi.createConversation(token, { customerId: newCustomerId, channel: newChannel });
      setSelectedId(conversation.id);
      setDetail(await backendApi.conversation(token, conversation.id));
      setMessage("Conversation ready on the selected WhatsApp provider.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Conversation could not be created.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {message && <div className="calendar-message">{message}</div>}
      <section className="admin-card inbox-start-bar">
        <div><p className="eyebrow">New outbound thread</p><strong>Start a WhatsApp conversation</strong></div>
        <select value={newCustomerId} onChange={(event) => setNewCustomerId(event.target.value)}><option value="">Select customer</option>{data.customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · {customer.phone ?? "No phone"}</option>)}</select>
        <select value={newChannel} onChange={(event) => setNewChannel(event.target.value as typeof newChannel)}><option value="WHATSAPP_OFFICIAL">Official Cloud API</option><option value="WHATSAPP_UNOFFICIAL">Unofficial QR session</option></select>
        <button className="button admin-primary" disabled={busy || !token || !newCustomerId} onClick={() => void startConversation()}>Start conversation</button>
      </section>
      <div className="inbox-layout admin-card">
        <aside className="conversation-list">
          <label>
            <span>⌕</span>
            <input value={inboxSearch} onChange={(event) => setInboxSearch(event.target.value)} placeholder="Name or phone" />
          </label>
          <button className={`inbox-unread-filter ${unreadOnly ? "active" : ""}`} onClick={() => setUnreadOnly((value) => !value)}>Unread only · {data.conversations.filter((item) => item.unread).length}</button>
          {conversationRows.map((item) => (
            <button
              key={item.id}
              className={selected?.id === item.id ? "active" : ""}
              onClick={() => void load(item.id)}
            >
              <span className={item.customer?.avatarUrl ? "has-photo" : ""}>
                {item.customer?.avatarUrl ? <Image src={item.customer.avatarUrl} alt="" width={48} height={48} unoptimized /> : initialsFor(item.customer?.name)}
              </span>
              <p>
                <strong>{item.customer?.name ?? "Guest conversation"}</strong>
                <small>{item.customer?.phone ?? "No phone"} · {prettyStatus(item.channel.type)}</small>
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
            <span className={selected?.customer?.avatarUrl ? "has-photo" : ""}>
              {selected?.customer?.avatarUrl ? <Image src={selected.customer.avatarUrl} alt="" width={48} height={48} unoptimized /> : initialsFor(selected?.customer?.name ?? "Inbox")}
            </span>
            <div>
              <strong>{selected?.customer?.name ?? "Unified inbox"}</strong>
              <small>
                {selected
                  ? `${selected.customer?.phone ?? "No phone"} · ${prettyStatus(selected.channel.type)}`
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
            {canUseTemplate && !internal && (
              <div className="whatsapp-template-controls">
                <label>
                  <select
                    value={templateMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as "text" | "template";
                      setTemplateMode(nextMode);
                    }}
                  >
                    <option value="text">Custom text</option>
                    <option value="template" disabled={!officialTemplates.length}>
                      Official template
                    </option>
                  </select>
                </label>
                {templateMode === "template" && (
                  <select
                    value={selectedTemplateId}
                    onChange={(event) => setSelectedTemplateId(event.target.value)}
                  >
                    <option value="">{officialTemplates.length ? "Choose template" : "No approved templates"}</option>
                    {officialTemplates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name} ({template.language}) · {template.status}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            )}
            <input
              value={body}
              onChange={(event) => setBody(event.target.value)}
              placeholder={
                internal ? "Write a team-only note…" : "Type a reply…"
              }
            />
            <button
              disabled={busy || sendDisabled}
              onClick={() => void send()}
            >
              {busy ? "…" : "Send ↑"}
            </button>
            <button
              disabled={busy || !selected}
              onClick={() => void sendRateList()}
            >
              {busy ? "…" : "Send rate list"}
            </button>
          </footer>
        </section>
        <aside className="contact-panel">
          <div className={`contact-avatar ${selected?.customer?.avatarUrl ? "has-photo" : ""}`}>
            {selected?.customer?.avatarUrl ? <Image src={selected.customer.avatarUrl} alt="" width={88} height={88} unoptimized /> : initialsFor(selected?.customer?.name ?? "Inbox")}
          </div>
          <h3>{selected?.customer?.name ?? "No contact selected"}</h3>
          <p>{selected ? `${selected.customer?.phone ?? "No phone"} · WhatsApp-style CRM contact` : "Select a thread"}</p>
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

function Campaigns({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("LAPSED");
  const [channel, setChannel] = useState<
    "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL" | "EMAIL"
  >("WHATSAPP_UNOFFICIAL");
  const [audienceMode, setAudienceMode] = useState<"SEGMENT" | "MANUAL">("SEGMENT");
  const [manualNumbers, setManualNumbers] = useState("");
  const [manualConsentConfirmed, setManualConsentConfirmed] = useState(false);
  const [lastImportSummary, setLastImportSummary] = useState("");
  const [verification, setVerification] = useState<Awaited<ReturnType<typeof backendApi.verifyCampaignPhones>> | null>(null);
  const [content, setContent] = useState("");
  const [offer, setOffer] = useState("");
  const [mediaKey, setMediaKey] = useState("");
  const [mediaType, setMediaType] = useState<"image" | "document" | "video" | "">("");
  const [mediaName, setMediaName] = useState("");
  const [ctaButtons, setCtaButtons] = useState<CampaignCtaDraft[]>([]);
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [waRisk, setWaRisk] = useState<BackendWhatsAppStatus["unofficial"]["risk"]>();
  useEffect(() => {
    if (!token) return;
    backendApi.whatsappStatus(token).then((result) => setWaRisk(result.unofficial.risk)).catch(() => undefined);
  }, [token, data.campaigns.length]);
  const attention = data.range
    ? data.range.customers.lapsed +
      data.customers.filter((item) => item.segments.includes("AT_RISK")).length
    : 0;
  const manualContacts = campaignContactsFromText(manualNumbers, manualConsentConfirmed);
  const manualStats = campaignAudienceStats(manualContacts.map((contact) => contact.phone));
  const manualRecipients = dedupeCampaignContacts(manualContacts);
  const validCtaButtons = sanitizeCampaignCtas(ctaButtons);
  const manualPhoneSet = new Set(manualStats.uniquePhones);
  const knownWhatsAppReady = data.customers.filter((customer) => customer.phone && manualPhoneSet.has(normalizeCampaignPhone(customer.phone)) && customer.waConsent).length;
  const campaignTotals = data.campaigns.reduce(
    (sum, campaign) => {
      const engagement = campaign.engagement;
      sum.total += engagement?.total ?? campaign._count.recipients;
      sum.sent += engagement?.sent ?? 0;
      sum.delivered += engagement?.delivered ?? 0;
      sum.read += engagement?.read ?? 0;
      sum.replied += engagement?.replied ?? 0;
      sum.failed += engagement?.failed ?? 0;
      return sum;
    },
    { total: 0, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0 },
  );
  const campaignRows = data.campaigns.map((item) => ({
    campaign: item,
    cells: [
        item.name,
        item.audienceLabel ?? (item.segment ? prettyStatus(item.segment) : "All customers"),
        prettyStatus(item.channel),
        prettyStatus(item.status),
        `${item.engagement?.sent ?? 0}/${item.engagement?.total ?? item._count.recipients}`,
        String(item.engagement?.delivered ?? 0),
        String(item.engagement?.read ?? 0),
        String(item.engagement?.replied ?? 0),
        String(item.engagement?.failed ?? 0),
        item.ctaJson?.length ? item.ctaJson.map((button) => button.label).join(", ") : "—",
      ],
  }));
  const visibleRows = statusFilter === "ALL"
    ? campaignRows
    : campaignRows.filter(({ campaign, cells }) => campaign.status === statusFilter || cells[3].toUpperCase().replaceAll(" ", "_") === statusFilter);
  const draft = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await backendApi.draftCampaign(token, {
        goal: name || "Bring customers back to the salon",
        segment,
        offer: offer || undefined,
      });
      setContent(result.content);
      setMessage("Draft ready. Review it before creating the campaign.");
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Draft failed.");
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    if (!token || !name || !content) return;
    setBusy(true);
    setMessage("");
    try {
      if (audienceMode === "MANUAL" && manualStats.valid < 1) throw new Error("Paste numbers or import a CSV before creating a manual campaign.");
      if (audienceMode === "MANUAL" && channel.startsWith("WHATSAPP") && !manualConsentConfirmed) throw new Error("Confirm WhatsApp consent before sending to pasted/CSV numbers.");
      if (audienceMode === "MANUAL" && channel === "EMAIL") throw new Error("Email campaigns need CRM customers with email consent. Use a CRM segment for email.");
      const result = await backendApi.createCampaign(token, {
        name,
        channel,
        segment: audienceMode === "SEGMENT" ? segment : undefined,
        content,
        branchId: "main",
        recipientContacts: audienceMode === "MANUAL" ? manualRecipients : undefined,
        recipientPhones: audienceMode === "MANUAL" ? manualStats.uniquePhones : undefined,
        manualConsentConfirmed: audienceMode === "MANUAL" ? manualConsentConfirmed : undefined,
        mediaKey: mediaKey || undefined,
        mediaType: mediaType || undefined,
        ctaButtons: validCtaButtons.length ? validCtaButtons : undefined,
      });
      setName("");
      setContent("");
      setMediaKey(""); setMediaType(""); setMediaName("");
      setCtaButtons([]);
      if (audienceMode === "MANUAL") setManualNumbers("");
      setLastImportSummary("");
      setMessage(`Campaign created for ${result._count.recipients} eligible contacts. Pasted/CSV numbers were kept campaign-only, not added to Customers.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Campaign could not be created.");
    } finally {
      setBusy(false);
    }
  };
  const uploadCreative = async (file?: File) => {
    if (!token || !file) return;
    setBusy(true); setMessage("");
    try {
      const base64 = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = reject; reader.readAsDataURL(file); });
      const upload = await backendApi.uploadMedia(token, { purpose: "campaign", contentType: file.type, base64 });
      setMediaKey(upload.key); setMediaName(file.name); setMediaType(file.type === "application/pdf" ? "document" : "image");
      setMessage("Campaign creative uploaded. It will be signed only when each message is sent.");
    } catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Creative upload failed."); }
    finally { setBusy(false); }
  };
  const approve = async (campaignId: string) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await backendApi.approveCampaign(token, campaignId);
      setMessage(result.status === "SCHEDULED" ? "Campaign approved. Safe pacing placed some messages in the next delivery window." : "Campaign approved and queued for immediate delivery.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Approval failed.");
    } finally {
      setBusy(false);
    }
  };
  const verifyManualNumbers = async () => {
    if (!token || !manualStats.valid) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await backendApi.verifyCampaignPhones(token, { branchId: "main", phones: manualStats.uniquePhones });
      setVerification(result);
      setMessage(result.providerConnected
        ? `Verification complete: ${result.registered} matched in WAHA contacts, ${result.unknown} unknown.`
        : `WAHA verification unavailable: ${result.valid} valid numbers, ${result.unknown} unknown.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "WhatsApp number verification failed.");
    } finally {
      setBusy(false);
    }
  };
  const importContacts = async (file?: File) => {
    if (!token || !file) return;
    setBusy(true);
    setMessage("");
    try {
      const contacts = csvContactsForCampaign(parseCsv(await file.text()), manualConsentConfirmed);
      const stats = campaignAudienceStats(contacts.map((contact) => contact.phone));
      if (!stats.valid) throw new Error("CSV did not contain any valid phone numbers.");
      const uniqueContacts = dedupeCampaignContacts(contacts);
      setAudienceMode("MANUAL");
      setManualNumbers(uniqueContacts.map((contact) => `${contact.name}, ${contact.phone}`).join("\n"));
      setVerification(null);
      setLastImportSummary(`${stats.total} numbers found · ${stats.valid} valid · ${stats.duplicates} duplicate · ${stats.invalid} invalid`);
      if (channel.startsWith("WHATSAPP") && !manualConsentConfirmed) {
        setMessage(`CSV loaded: ${stats.valid} valid campaign-only numbers. Tick consent confirmation before sending WhatsApp campaign.`);
        return;
      }
      setMessage(`CSV loaded: ${stats.valid} valid campaign-only numbers. Nothing was added to Customers/CRM.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : "CSV import failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div>
      {message && <div className="calendar-message">{message}</div>}
      <div className="campaign-banner">
        <div>
          <p className="eyebrow">Smart follow-up</p>
          <h2>{attention} customers may need a reason to return.</h2>
          <p>Campaigns send now after approval, with backend pacing and opt-out safety.</p>
        </div>
        <button className="button button-light" onClick={() => void draft()} disabled={!token || busy}>
          {busy ? "Working…" : "Draft reactivation campaign"}
        </button>
      </div>
      <section className="campaign-safety-grid">
        <article className="admin-card csv-import-card">
          <div><p className="eyebrow">Marketing audience</p><h2>CSV or pasted numbers</h2><p>CSV can contain only phone numbers; name is optional. These numbers are campaign-only and are not saved to Customers/CRM.</p></div>
          <label className="csv-picker"><span>{busy ? "Reading…" : "Choose CSV file"}</span><input type="file" accept=".csv,text/csv" disabled={busy || !token} onChange={(event) => void importContacts(event.target.files?.[0])} /></label>
          <label className="campaign-consent"><input type="checkbox" checked={manualConsentConfirmed} onChange={(event) => setManualConsentConfirmed(event.target.checked)} /> I have permission to send WhatsApp marketing to pasted/CSV numbers.</label>
          <textarea value={manualNumbers} onChange={(event) => { setManualNumbers(event.target.value); setAudienceMode("MANUAL"); setVerification(null); }} rows={5} placeholder={"Paste mobile numbers here…\n9876543210\nRiya Sharma, 9123456789"} />
          <div className="campaign-audience-stats">
            <span><strong>{manualStats.total}</strong><small>Numbers found</small></span>
            <span><strong>{manualStats.valid}</strong><small>Valid format</small></span>
            <span><strong>{verification?.registered ?? knownWhatsAppReady}</strong><small>{verification ? "WAHA matched" : "Known opted-in CRM"}</small></span>
            <span><strong>{manualStats.duplicates}</strong><small>Duplicates</small></span>
          </div>
          <button className="button campaign-verify-button" disabled={!token || busy || !manualStats.valid} onClick={() => void verifyManualNumbers()}>
            {busy ? "Checking…" : "Verify WhatsApp numbers"}
          </button>
          {lastImportSummary && <small>{lastImportSummary}</small>}
          <small>{verification ? verification.detail : "WAHA verification checks known WhatsApp contacts when connected; delivery report still remains the final truth."}</small>
        </article>
        <article className={`admin-card campaign-risk-card risk-${waRisk?.label ?? "high"}`}>
          <p className="eyebrow">Unofficial WhatsApp risk</p>
          <div><strong>{waRisk?.score ?? "—"}/100</strong><span>{waRisk ? prettyStatus(waRisk.label) : "Awaiting WAHA status"}</span></div>
          <progress max="100" value={waRisk?.score ?? 100} />
          <p>{waRisk ? `${waRisk.safeguards.intervalSeconds}s spacing · ${waRisk.safeguards.dailyCap}/day · ${waRisk.safeguards.deliveryWindow}` : "Connect WAHA to calculate the current operational signal."}</p>
          <small>This is a conservative heuristic, not a ban probability or guarantee. Unofficial access always retains meaningful account risk.</small>
        </article>
      </section>
      <section className="campaign-report-grid">
        <article><small>Total audience</small><strong>{campaignTotals.total}</strong><span>All campaign recipients</span></article>
        <article><small>Sent</small><strong>{campaignTotals.sent}</strong><span>Queued/sent through channels</span></article>
        <article><small>Delivered / read</small><strong>{campaignTotals.delivered}/{campaignTotals.read}</strong><span>Provider engagement</span></article>
        <article><small>Replies / failed</small><strong>{campaignTotals.replied}/{campaignTotals.failed}</strong><span>Follow-up and cleanup list</span></article>
      </section>
      <section className="admin-card campaign-builder phase-one-form">
        <div><p className="eyebrow">Send now after approval</p><h2>Create campaign</h2><small>Choose a CRM segment for saved customers, or use pasted/CSV numbers as campaign-only recipients. Unofficial WhatsApp appends “Reply STOP to opt out” and uses pacing to reduce ban risk.</small></div>
        <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="August comeback offer" /></label>
        <label>Audience mode<select value={audienceMode} onChange={(event) => setAudienceMode(event.target.value as "SEGMENT" | "MANUAL")}><option value="SEGMENT">CRM segment</option><option value="MANUAL">CSV / pasted numbers</option></select></label>
        <label>CRM audience<select value={segment} onChange={(event) => setSegment(event.target.value)} disabled={audienceMode === "MANUAL"}><option value="NEW">New</option><option value="REPEAT">Repeat</option><option value="VIP">VIP</option><option value="AT_RISK">At-risk</option><option value="LAPSED">Lapsed</option><option value="MEMBER">Members</option><option value="HIGH_SPEND">High spend</option></select></label>
        <label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="WHATSAPP_OFFICIAL">WhatsApp Official</option><option value="WHATSAPP_UNOFFICIAL">WhatsApp Unofficial</option><option value="EMAIL">Email</option></select></label>
        <label>Offer<input value={offer} onChange={(event) => setOffer(event.target.value)} placeholder="20% off on weekday services" /></label>
        <label>Image / PDF creative<span className="campaign-file-picker">{mediaName || "Choose creative"}<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(event) => void uploadCreative(event.target.files?.[0])} /></span></label>
        <label className="campaign-copy">Message<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} /></label>
        <div className="campaign-cta-builder">
          <div>
            <p className="eyebrow">Campaign buttons</p>
            <h3>Call, website or location CTA</h3>
            <small>These appear under the message as tappable phone, website, or Maps links. Add up to 3.</small>
          </div>
          {ctaButtons.map((button) => (
            <div className="campaign-cta-row" key={button.id}>
              <label>Type<select value={button.type} onChange={(event) => setCtaButtons((current) => current.map((item) => item.id === button.id ? { ...item, type: event.target.value as BackendCampaignCtaButton["type"], value: "" } : item))}><option value="WEBSITE">Website</option><option value="CALL">Call</option><option value="LOCATION">Location</option></select></label>
              <label>Button text<input value={button.label} maxLength={32} onChange={(event) => setCtaButtons((current) => current.map((item) => item.id === button.id ? { ...item, label: event.target.value } : item))} placeholder={button.type === "CALL" ? "Call salon" : button.type === "LOCATION" ? "Get directions" : "Book now"} /></label>
              <label>Link / phone / address<input value={button.value} onChange={(event) => setCtaButtons((current) => current.map((item) => item.id === button.id ? { ...item, value: event.target.value } : item))} placeholder={campaignCtaHint(button.type)} /></label>
              <button type="button" aria-label={`Remove ${button.label || "CTA"} button`} onClick={() => setCtaButtons((current) => current.filter((item) => item.id !== button.id))}>Remove</button>
            </div>
          ))}
          <button className="button" type="button" disabled={ctaButtons.length >= 3} onClick={() => setCtaButtons((current) => [...current, newCampaignCta()])}>
            + Add campaign button
          </button>
          {validCtaButtons.length > 0 && (
            <div className="campaign-cta-preview">
              {validCtaButtons.map((button) => (
                <span key={`${button.type}-${button.label}-${button.value}`}>{button.type === "CALL" ? "☎" : button.type === "LOCATION" ? "⌖" : "↗"} {button.label}</span>
              ))}
            </div>
          )}
        </div>
        {audienceMode === "MANUAL" && (
          <div className="campaign-manual-review">
            <p className="eyebrow">Selected recipients</p>
            <h3>{manualStats.valid} campaign-only number{manualStats.valid === 1 ? "" : "s"} ready</h3>
            <small>
              These exact pasted/CSV recipients will go into Create Campaign. They will not be added to Customers.
              {manualStats.duplicates ? ` ${manualStats.duplicates} duplicate removed.` : ""}
              {manualStats.invalid ? ` ${manualStats.invalid} invalid ignored.` : ""}
            </small>
            <div>
              {manualRecipients.slice(0, 8).map((contact) => (
                <span key={contact.phone}>{contact.name} · {contact.phone}</span>
              ))}
              {manualRecipients.length > 8 && <span>+{manualRecipients.length - 8} more</span>}
            </div>
          </div>
        )}
        <div className="form-actions"><button disabled={!token || busy} onClick={() => void draft()}>AI draft</button><button className="button admin-primary" disabled={!token || busy || !name || !content || (audienceMode === "MANUAL" && !manualStats.valid)} onClick={() => void create()}>Create for approval</button></div>
      </section>
      <div className="campaign-steps">
        {[
          ["1", "Audience", audienceMode === "MANUAL" ? `${manualStats.valid} pasted/CSV numbers` : `At-risk / lapsed · ${attention}`],
          ["2", "Safety", "Campaign-only import, consent and STOP opt-out"],
          ["3", "Channel", "Official or unofficial WhatsApp"],
          ["4", "Reports", "Sent, delivered, read, replied, failed"],
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
                : "No campaigns created yet"}
            </p>
          </div>
          <select
            aria-label="Filter campaigns by status"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
          >
            <option value="ALL">All statuses</option>
            <option value="PENDING_APPROVAL">Pending approval</option>
            <option value="SCHEDULED">Scheduled</option>
            <option value="SENDING">Sending</option>
            <option value="SENT">Sent</option>
            <option value="FAILED">Failed</option>
          </select>
        </div>
        <div className="campaign-table-labels"><span>Campaign</span><span>Audience</span><span>Channel</span><span>Status</span><span>Sent / total</span><span>Delivered</span><span>Read</span><span>Replied</span><span>Failed</span><span>Buttons</span></div>
        {visibleRows.map(({ campaign, cells }) => (
          <div className="campaign-row" key={campaign.id}>
            {cells.map((cell, index) =>
              index === 0 ? (
                <strong key={cell}>{cell}</strong>
              ) : (
                <span key={`${cell}${index}`}>{cell}</span>
              ),
            )}
            {campaign.status === "PENDING_APPROVAL" && (
              <button disabled={busy} onClick={() => void approve(campaign.id)}>Approve</button>
            )}
          </div>
        ))}
      </article>
    </div>
  );
}

function Reports({ token, data }: { token: string; data: BackendSnapshot }) {
  const today = localDateKey(new Date());
  const [from, setFrom] = useState(`${today.slice(0, 7)}-01`);
  const [to, setTo] = useState(today);
  const [staffId, setStaffId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [report, setReport] = useState<BackendRangeReport | null>(data.range);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const services = data.categories.flatMap((category) => category.services);
  const load = async (nextFrom = from, nextTo = to) => {
    if (!token || !nextFrom || !nextTo) return;
    setBusy(true); setMessage("");
    try {
      const range = dateRangeIso(nextFrom, nextTo);
      setReport(await backendApi.rangeReport(token, range.from, range.to, "main", { staffId: staffId || undefined, serviceId: serviceId || undefined }));
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Report could not be loaded.");
    } finally { setBusy(false); }
  };
  const applyPreset = (days: number | "month" | "year") => {
    const end = today;
    const start = days === "month" ? `${today.slice(0, 7)}-01` : days === "year" ? `${today.slice(0, 4)}-01-01` : shiftDateKey(today, -(days - 1));
    setFrom(start); setTo(end); void load(start, end);
  };
  const repeatRate = report?.customers.total ? Math.round((report.customers.repeat / report.customers.total) * 100) : 0;
  const top: Array<[string, number]> = report?.topServices ?? [];
  const max = Math.max(...top.map((item) => item[1]), 1);
  const exportCsv = () => {
    if (!report) return;
    const rows: Array<Array<string | number>> = [
      ["Metric", "Value"],
      ["Gross sales (minor units)", report.salesMinor],
      ["Completed bills", report.bills],
      ["New customers", report.customers.new],
      ["Repeat customers", report.customers.repeat],
      ["Lapsed customers", report.customers.lapsed],
      [],
      ["Payment method", "Collected (minor units)"],
      ...Object.entries(report.paymentMix),
      [],
      ["Service", "Revenue (minor units)"],
      ...report.topServices,
    ];
    const csv = rows.map((row) => row.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `cutz-bangs-report-${from}-to-${to}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="reports-view">
      {message && <div className="calendar-message">{message}</div>}
      <div className="report-filters">
        <button onClick={() => applyPreset(1)}>Today</button>
        <button onClick={() => applyPreset(7)}>7 days</button>
        <button onClick={() => applyPreset(15)}>15 days</button>
        <button onClick={() => applyPreset("month")}>This month</button>
        <button onClick={() => applyPreset("year")}>This year</button>
        <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label>To<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></label>
        <label>Service<select value={serviceId} onChange={(event) => setServiceId(event.target.value)}><option value="">All services</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label>Staff<select value={staffId} onChange={(event) => setStaffId(event.target.value)}><option value="">All staff</option>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName}</option>)}</select></label>
        <button className="apply-report" disabled={busy || !from || !to || to < from} onClick={() => void load()}>{busy ? "Loading…" : "Apply filters"}</button>
        <button disabled={!report} onClick={exportCsv}>Export CSV</button>
        <button onClick={() => window.print()}>Print / save PDF</button>
      </div>
      <div className="metric-grid report-metrics">
        {[
          [
            "Gross sales",
            money(report?.salesMinor ?? 0),
            report ? "Live" : "No live data",
          ],
          [
            "Completed bills",
            String(report?.bills ?? 0),
            report ? "Live" : "No live data",
          ],
          [
            "Repeat customers",
            `${repeatRate}%`,
            report ? `${report.customers.repeat} customers` : "No live data",
          ],
          [
            "Total customers",
            String(report?.customers.total ?? 0),
            report ? "Live CRM" : "No live data",
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
            {Object.entries(report?.paymentMix ?? {}).map(([method, amount]) => (
              <p key={method}>
                <span>{prettyStatus(method)}</span>
                <strong>{money(amount)}</strong>
              </p>
            ))}
            {!Object.keys(report?.paymentMix ?? {}).length && <p className="empty-cart">Payment totals will appear after live bills.</p>}
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
            {!top.length && <p className="empty-cart">Service revenue will appear after live bills.</p>}
          </div>
        </article>
      </div>
      <article className="admin-card report-staff-ranking">
        <div className="card-head"><div><h2>Staff sales attribution</h2><p>Invoice lines assigned to each staff member in the selected range.</p></div><span className="filter-button">{from} → {to}</span></div>
        <div className="report-staff-grid">
          {(report?.topStaff ?? []).map(([id, value], index) => <span key={id}><i>{index + 1}</i><strong>{data.staff.find((staff) => staff.id === id)?.displayName ?? id}</strong><b>{money(value)}</b></span>)}
          {!report?.topStaff.length && <p className="empty-cart">Staff-attributed sales will appear here.</p>}
        </div>
      </article>
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
  const [editingStaffId, setEditingStaffId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [designation, setDesignation] = useState("Stylist");
  const [baseSalary, setBaseSalary] = useState(0);
  const [commissionRate, setCommissionRate] = useState(0);
  const [commissionThreshold, setCommissionThreshold] = useState(0);
  const [shiftStart, setShiftStart] = useState("10:00");
  const [shiftEnd, setShiftEnd] = useState("20:00");
  const [weeklyOff, setWeeklyOff] = useState<number[]>([]);
  const [lateGraceMinutes, setLateGraceMinutes] = useState(10);
  const [lateDeduction, setLateDeduction] = useState(0);
  const [halfDayAfterMinutes, setHalfDayAfterMinutes] = useState(240);
  const [overtimePaid, setOvertimePaid] = useState(false);
  const [biometricCode, setBiometricCode] = useState("");
  const [serviceIds, setServiceIds] = useState<string[]>([]);
  const [accountStaffId, setAccountStaffId] = useState("");
  const [accountEmail, setAccountEmail] = useState("");
  const [accountRole, setAccountRole] = useState<"ADMIN" | "MANAGER" | "RECEPTION" | "STAFF">("STAFF");
  const [accountCommission, setAccountCommission] = useState(0);
  const [accountPermissions, setAccountPermissions] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const services = data.categories.flatMap((category) => category.services);
  const permissionOptions = [
    ["dashboard", "Dashboard"], ["calendar", "Calendar & advance bookings"], ["pos", "Point of sale"], ["customers", "Customers & loyalty"],
    ["memberships", "Memberships & packages"], ["inbox", "Inbox"], ["services", "Service catalogue"], ["inventory", "Inventory"],
    ["cash", "Cash & expenses"], ["website", "Website content"], ["coupons", "Coupons"], ["campaigns", "Campaigns"],
    ["reports", "Reports"], ["staff", "Staff & attendance"], ["payroll", "Payroll"], ["settings", "Integration settings"], ["audit", "System & audit"],
  ] as const;
  const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const minutesFromClock = (clock: string) => {
    const [hour = "0", minute = "0"] = clock.split(":");
    return Number(hour) * 60 + Number(minute);
  };
  const create = async () => {
    if (!token || !displayName) return;
    setBusy(true);
    setMessage("");
    try {
      const workforceProfile = {
        displayName,
        phone: phone || undefined,
        designation,
        baseSalaryMinor: Math.round(baseSalary * 100),
        commissionRate: Math.round(commissionRate * 100),
        commissionThresholdMinor: Math.round(commissionThreshold * 100),
        lateGraceMinutes,
        lateDeductionMinor: Math.round(lateDeduction * 100),
        halfDayAfterMinutes,
        overtimePaid,
        biometricCode: biometricCode || undefined,
        weeklyOff,
        shifts: weekdays.flatMap((_, weekday) => weeklyOff.includes(weekday) ? [] : [{ weekday, startMin: minutesFromClock(shiftStart), endMin: minutesFromClock(shiftEnd) }]),
      };
      if (editingStaffId) await backendApi.updateStaffProfile(token, editingStaffId, workforceProfile);
      else await backendApi.createStaff(token, {
        branchId: "main",
        ...workforceProfile,
        serviceIds,
      });
      setDisplayName("");
      setPhone("");
      setDesignation("Stylist");
      setBaseSalary(0);
      setCommissionRate(0);
      setCommissionThreshold(0);
      setBiometricCode("");
      setServiceIds([]);
      setEditingStaffId("");
      setShowCreate(false);
      setMessage(editingStaffId ? "Staff work policy, timing and payroll rules updated." : "Staff profile created with selected booking skills.");
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
  const sendInvite = async () => {
    if (!token || !accountStaffId || !accountEmail) return;
    setBusy(true); setMessage("");
    try {
      const invite = await backendApi.inviteStaff(token, accountStaffId, { email: accountEmail, role: accountRole, permissionKeys: accountPermissions, commissionRate: Math.round(accountCommission * 100) });
      setMessage(`Secure ${prettyStatus(accountRole)} invitation queued to ${invite.email}. They will create their own password.`); onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Team invitation could not be sent."); }
    finally { setBusy(false); }
  };
  const team = data.teamAccounts.length ? data.teamAccounts : data.staff;
  const rows = team.map((staff) => [
        staff.displayName
          .split(" ")
          .map((part) => part[0])
          .join("")
          .slice(0, 2),
        staff.displayName,
        `${staff.designation ?? "Stylist"} · ${staff.user ? prettyStatus(staff.user.role) : "No login"}`,
        `${data.categories.flatMap((category) => category.services).filter((service) => service.serviceStaff.some((link) => link.staff.id === staff.id)).length} services`,
        money(data.range?.topStaff.find(([id]) => id === staff.id)?.[1] ?? 0),
      ]);
  return (
    <div className="staff-view">
      {message && <div className="calendar-message">{message}</div>}
      <button
        className="button admin-primary staff-create-trigger"
        onClick={() => { setEditingStaffId(""); setDisplayName(""); setPhone(""); setShowCreate((current) => !current); }}
      >
        + Add staff
      </button>
      {showCreate && (
        <section className="admin-card phase-one-form">
          <div>
            <p className="eyebrow">Team setup</p>
            <h2>{editingStaffId ? "Edit staff work policy" : "New staff profile"}</h2>
          </div>
          <label>
            Name
            <input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </label>
          <label>Designation<input value={designation} onChange={(event) => setDesignation(event.target.value)} placeholder="Senior stylist" /></label>
          <label>Base salary (₹ / month)<input type="number" min="0" value={baseSalary} onChange={(event) => setBaseSalary(Math.max(0, Number(event.target.value)))} /></label>
          <label>
            Commission %
            <input type="number" min="0" max="100" step="0.25" value={commissionRate} onChange={(event) => setCommissionRate(Number(event.target.value))} />
          </label>
          <label>Commission starts after daily sales (₹)<input type="number" min="0" value={commissionThreshold} onChange={(event) => setCommissionThreshold(Math.max(0, Number(event.target.value)))} /></label>
          <label>
            Phone
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </label>
          <label>Shift starts<input type="time" value={shiftStart} onChange={(event) => setShiftStart(event.target.value)} /></label>
          <label>Shift ends<input type="time" value={shiftEnd} onChange={(event) => setShiftEnd(event.target.value)} /></label>
          <label>Late grace (minutes)<input type="number" min="0" max="180" value={lateGraceMinutes} onChange={(event) => setLateGraceMinutes(Number(event.target.value))} /></label>
          <label>Deduction for each late day (₹)<input type="number" min="0" value={lateDeduction} onChange={(event) => setLateDeduction(Math.max(0, Number(event.target.value)))} /></label>
          <label>Half day below (worked minutes)<input type="number" min="30" max="720" value={halfDayAfterMinutes} onChange={(event) => setHalfDayAfterMinutes(Number(event.target.value))} /></label>
          <label>Biometric employee code<input value={biometricCode} onChange={(event) => setBiometricCode(event.target.value)} placeholder="EMP-001" /></label>
          <fieldset className="weekly-off-field"><legend>Weekly off</legend>{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={weeklyOff.includes(index)} onChange={(event) => setWeeklyOff((current) => event.target.checked ? [...current, index] : current.filter((value) => value !== index))} />{day}</label>)}</fieldset>
          <label className="consent-box"><input type="checkbox" checked={overtimePaid} onChange={(event) => setOvertimePaid(event.target.checked)} /><span>Pay overtime (off by default)</span></label>
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
            {busy ? "Saving…" : editingStaffId ? "Save staff policy" : "Create staff"}
          </button>
        </section>
      )}
      <section className="admin-card phase-one-form team-access-form">
        <div><p className="eyebrow">Role-based access</p><h2>Email a secure team invitation</h2><small>The employee creates their own password from a one-time 48-hour link. Passwords are never visible or shared by the owner.</small></div>
        <label>Team member<select value={accountStaffId} onChange={(event) => { const id = event.target.value; setAccountStaffId(id); const member = team.find((item) => item.id === id); setAccountEmail(member?.user?.email ?? ""); setAccountRole((member?.user?.role as typeof accountRole) ?? "STAFF"); setAccountCommission((member?.commissionRate ?? 0) / 100); setAccountPermissions(member?.user?.permissionKeys?.length ? member.user.permissionKeys : ["dashboard"]); }}><option value="">Select team member</option>{team.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.user ? prettyStatus(member.user.role) : "No login"}</option>)}</select></label>
        <label>Login role<select value={accountRole} onChange={(event) => setAccountRole(event.target.value as typeof accountRole)}>{data.user?.role === "OWNER" && <option value="ADMIN">Admin</option>}<option value="MANAGER">Manager</option><option value="RECEPTION">Reception</option><option value="STAFF">Staff</option></select></label>
        <label>Email<input type="email" value={accountEmail} onChange={(event) => setAccountEmail(event.target.value)} /></label>
        <label>Commission %<input type="number" min="0" max="100" step="0.25" value={accountCommission} onChange={(event) => setAccountCommission(Number(event.target.value))} /></label>
        <fieldset className="staff-permission-grid"><legend>Allowed sections (tick only what this account needs)</legend>{permissionOptions.map(([key, label]) => <label key={key}><input type="checkbox" checked={accountPermissions.includes(key)} disabled={key === "dashboard"} onChange={(event) => setAccountPermissions((current) => event.target.checked ? [...current, key] : current.filter((permission) => permission !== key))} />{label}</label>)}</fieldset>
        <button className="button admin-primary" disabled={busy || !accountStaffId || !accountEmail || !accountPermissions.length} onClick={() => void sendInvite()}>{busy ? "Sending…" : "Email secure invitation"}</button>
      </section>
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
            <p className="staff-policy-summary">{team[index]?.user?.email ?? "Login not created"} · {(team[index]?.commissionRate ?? 0) / 100}% after {money(team[index]?.commissionThresholdMinor ?? 0)}</p>
            <button
              onClick={() => {
                const member = team[index];
                if (!member) return;
                setAccountStaffId(member.id);
                setAccountEmail(member.user?.email ?? "");
                setAccountRole((member.user?.role as typeof accountRole) ?? "STAFF");
                setAccountCommission((member.commissionRate ?? 0) / 100);
                setAccountPermissions(member.user?.permissionKeys?.length ? member.user.permissionKeys : ["dashboard"]);
                setEditingStaffId(member.id);
                setDisplayName(member.displayName);
                setPhone(member.phone ?? "");
                setDesignation(member.designation ?? "Stylist");
                setBaseSalary((member.baseSalaryMinor ?? 0) / 100);
                setCommissionRate((member.commissionRate ?? 0) / 100);
                setCommissionThreshold((member.commissionThresholdMinor ?? 0) / 100);
                setLateGraceMinutes(member.lateGraceMinutes ?? 10);
                setLateDeduction((member.lateDeductionMinor ?? 0) / 100);
                setHalfDayAfterMinutes(member.halfDayAfterMinutes ?? 240);
                setOvertimePaid(Boolean(member.overtimePaid));
                setBiometricCode(member.biometricCode ?? "");
                setWeeklyOff(member.weeklyOff ?? []);
                const firstShift = member.shifts?.[0];
                if (firstShift) {
                  setShiftStart(`${String(Math.floor(firstShift.startMin / 60)).padStart(2, "0")}:${String(firstShift.startMin % 60).padStart(2, "0")}`);
                  setShiftEnd(`${String(Math.floor(firstShift.endMin / 60)).padStart(2, "0")}:${String(firstShift.endMin % 60).padStart(2, "0")}`);
                }
                setShowCreate(true);
                window.setTimeout(() => document.querySelector(".staff-view .phase-one-form")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
              }}
            >
              Manage profile →
            </button>
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
  const [leaveStaffId, setLeaveStaffId] = useState("");
  const [leaveFrom, setLeaveFrom] = useState(localDateKey(new Date()));
  const [leaveTo, setLeaveTo] = useState(localDateKey(new Date()));
  const [leaveReason, setLeaveReason] = useState("");
  const [deviceName, setDeviceName] = useState("");
  const [deviceCredential, setDeviceCredential] = useState<{ secret: string; webhookPath: string } | null>(null);
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
  const requestLeave = async () => {
    if (!token || !leaveStaffId || !leaveReason.trim()) return;
    setBusy(true); setMessage("");
    try {
      await backendApi.createLeave(token, { staffId: leaveStaffId, startDate: leaveFrom, endDate: leaveTo, reason: leaveReason, approved: true });
      setLeaveReason(""); setMessage("Leave recorded and approved by the administrator."); onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Leave could not be recorded."); }
    finally { setBusy(false); }
  };
  const reviewLeave = async (leaveId: string, approved: boolean) => {
    if (!token) return;
    setBusy(true); setMessage("");
    try { await backendApi.reviewLeave(token, leaveId, approved); setMessage(approved ? "Leave approved." : "Leave marked unapproved."); onRefresh(); }
    catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Leave could not be reviewed."); }
    finally { setBusy(false); }
  };
  const createDevice = async () => {
    if (!token || !deviceName.trim()) return;
    setBusy(true); setMessage("");
    try {
      const device = await backendApi.createBiometricDevice(token, { branchId: "main", name: deviceName, provider: "GENERIC_WEBHOOK" });
      setDeviceCredential({ secret: device.secret, webhookPath: device.webhookPath }); setDeviceName(""); setMessage("Biometric webhook created. Copy the secret now; it will not be shown again."); onRefresh();
    } catch (cause) { setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Biometric device could not be added."); }
    finally { setBusy(false); }
  };
  const rows = data.attendance.map((item) => {
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
      });
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
      <div className="workforce-admin-grid">
        <section className="admin-card phase-one-form leave-admin-card">
          <div><p className="eyebrow">Leave calendar</p><h2>Add or review leave</h2><small>Approved dates are returned to the staff portal and can be used by scheduling.</small></div>
          <label>Staff<select value={leaveStaffId} onChange={(event) => setLeaveStaffId(event.target.value)}><option value="">Select staff</option>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.displayName}</option>)}</select></label>
          <label>From<input type="date" value={leaveFrom} onChange={(event) => setLeaveFrom(event.target.value)} /></label>
          <label>To<input type="date" min={leaveFrom} value={leaveTo} onChange={(event) => setLeaveTo(event.target.value)} /></label>
          <label>Reason<input value={leaveReason} onChange={(event) => setLeaveReason(event.target.value)} placeholder="Weekly off / personal leave" /></label>
          <button className="button admin-primary" disabled={busy || !leaveStaffId || !leaveReason.trim() || leaveTo < leaveFrom} onClick={() => void requestLeave()}>Save approved leave</button>
          <div className="leave-list">{data.leaves.slice(0, 8).map((leave) => <div key={leave.id}><span><strong>{leave.staff?.displayName ?? data.staff.find((staff) => staff.id === leave.staffId)?.displayName ?? "Staff"}</strong><small>{new Date(leave.startDate).toLocaleDateString("en-IN")} → {new Date(leave.endDate).toLocaleDateString("en-IN")} · {leave.reason}</small></span><button className={leave.approved ? "approved" : "pending"} disabled={busy} onClick={() => void reviewLeave(leave.id, !leave.approved)}>{leave.approved ? "Approved" : "Approve"}</button></div>)}{!data.leaves.length && <p className="empty-cart">No leave requests yet.</p>}</div>
        </section>
        <section className="admin-card phase-one-form biometric-admin-card">
          <div><p className="eyebrow">Biometric bridge</p><h2>Connect attendance device</h2><small>Use a device or middleware that can POST JSON webhooks. Match its employee code with each staff profile.</small></div>
          <label>Device name<input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} placeholder="Main entrance biometric" /></label>
          <button className="button admin-primary" disabled={busy || !deviceName.trim()} onClick={() => void createDevice()}>Generate webhook credential</button>
          {deviceCredential && <div className="one-time-secret"><strong>Copy once</strong><label>Webhook<input readOnly value={deviceCredential.webhookPath} onFocus={(event) => event.target.select()} /></label><label>Bearer secret<input readOnly value={deviceCredential.secret} onFocus={(event) => event.target.select()} /></label><small>Send eventId, employeeCode, action (CHECK_IN/CHECK_OUT) and occurredAt.</small></div>}
          <div className="device-list">{data.biometricDevices.map((device) => <span key={device.id}><i className={device.isActive ? "ok" : "warn"}>{device.isActive ? "✓" : "!"}</i><strong>{device.name}</strong><small>{device.lastSeenAt ? `Last sync ${new Date(device.lastSeenAt).toLocaleString("en-IN")}` : "Waiting for first event"}</small></span>)}</div>
        </section>
      </div>
      <article className="admin-card attendance-card">
        <div className="card-head">
          <div>
            <h2>This month’s attendance</h2>
            <p>
              {data.attendance.length
                ? "Live, audited records"
                : "No attendance recorded yet"}
            </p>
          </div>
          <span className="filter-button">GPS + selfie + consent</span>
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
            <span className="attendance-status-label">Audited</span>
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
          <span>Attributed sales</span>
          <strong>
            {money(
              data.payroll.reduce(
                (sum, row) => sum + row.serviceRevenueMinor + (row.productRevenueMinor ?? 0),
                0,
              ),
            )}
          </strong>
          <small>Attributed invoice lines</small>
        </article>
        <article>
          <span>Estimated commission</span>
          <strong>{money(totalCommission)}</strong>
          <small>Service rate + product-specific retail commission</small>
        </article>
        <article>
          <span>Estimated payroll</span>
          <strong>{money(data.payroll.reduce((sum, row) => sum + (row.estimatedPayMinor ?? row.commissionMinor), 0))}</strong>
          <small>Base salary − late deductions + commission</small>
        </article>
      </div>
      <article className="admin-card payroll-table">
        <header>
          <span>Staff</span>
          <span>Present days</span>
          <span>Worked</span>
          <span>Late</span>
          <span>Salary / deduction</span>
          <span>Service / retail</span>
          <span>Commission</span>
          <span>Estimated pay</span>
        </header>
        {data.payroll.map((row) => (
          <div key={row.staffId}>
            <strong>{row.displayName}</strong>
            <span>{row.presentDays}</span>
            <span>
              {Math.floor(row.workedMinutes / 60)}h {row.workedMinutes % 60}m
            </span>
            <span>{row.lateMinutes}m · {row.lateDays ?? 0} days · {row.halfDays ?? 0} half</span>
            <span>{money(row.baseSalaryMinor ?? 0)} / −{money(row.lateDeductionMinor ?? 0)}</span>
            <span>{money(row.serviceRevenueMinor)} / {money(row.productRevenueMinor ?? 0)}</span>
            <strong>
              {money(row.commissionMinor)}{" "}
              <small>({row.commissionRateBps / 100}% service · {money(row.productCommissionMinor ?? 0)} retail)</small>
            </strong>
            <strong>{money(row.estimatedPayMinor ?? row.commissionMinor)}</strong>
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

function Invoices({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [archive, setArchive] = useState<BackendInvoiceArchive | null>(null);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [message, setMessage] = useState("");
  const [deliveryStatus, setDeliveryStatus] = useState<{
    invoiceId: string;
    kind: "sending" | "success" | "error";
    text: string;
  } | null>(null);

  const fallbackItems: BackendInvoiceArchiveItem[] = data.invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    status: invoice.status,
    subtotalMinor: invoice.subtotalMinor,
    discountMinor: invoice.discountMinor,
    taxMinor: invoice.taxMinor,
    totalMinor: invoice.totalMinor,
    paidMinor: invoice.paidMinor,
    createdAt: invoice.createdAt,
    pdfReady: Boolean(invoice.pdfUrl),
    downloadPath: `/api/v1/invoices/${invoice.id}/pdf?download=1`,
    customer: invoice.customer,
  }));

  const loadArchive = async (page = 1) => {
    if (!token) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await backendApi.invoiceArchive(token, {
        branchId: "main",
        q: query.trim() || undefined,
        status: status || undefined,
        from: from ? new Date(`${from}T00:00:00`).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59.999`).toISOString() : undefined,
        page,
        pageSize: 25,
      });
      setArchive(result);
    } catch (cause) {
      setMessage(cause instanceof Error ? `Invoice archive could not load: ${prettyStatus(cause.message)}.` : "Invoice archive could not load.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    backendApi.invoiceArchive(token, { branchId: "main", page: 1, pageSize: 25 })
      .then((result) => { if (!cancelled) setArchive(result); })
      .catch((cause) => { if (!cancelled) setMessage(cause instanceof Error ? `Invoice archive could not load: ${prettyStatus(cause.message)}.` : "Invoice archive could not load."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [token]);

  const openPdf = async (invoice: BackendInvoiceArchiveItem, download: boolean) => {
    if (!token) return;
    setBusyId(invoice.id);
    setMessage("");
    try {
      const url = await backendApi.invoicePdfBlob(token, invoice.id);
      if (download) {
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `${invoice.number}.pdf`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
        setMessage(`${invoice.number} downloaded.`);
      } else {
        const opened = window.open(url, "_blank", "noopener,noreferrer");
        window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
        setMessage(opened ? `${invoice.number} opened in a new tab.` : "Allow pop-ups to open the PDF preview.");
      }
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Invoice PDF could not be opened.");
    } finally {
      setBusyId("");
    }
  };

  const deliver = async (
    invoice: BackendInvoiceArchiveItem,
    channel: "EMAIL" | "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL",
  ) => {
    if (!token) return;
    const customer = invoice.customer;
    if (channel === "EMAIL" && !customer?.email) {
      setDeliveryStatus({ invoiceId: invoice.id, kind: "error", text: "Customer email is missing." });
      return;
    }
    if (channel !== "EMAIL" && !customer?.phone) {
      setDeliveryStatus({ invoiceId: invoice.id, kind: "error", text: "Customer mobile number is missing." });
      return;
    }
    setBusyId(invoice.id);
    setMessage("");
    setDeliveryStatus({
      invoiceId: invoice.id,
      kind: "sending",
      text: `${prettyStatus(channel)} delivery is running. WhatsApp sends in the background; no app window opens.`,
    });
    try {
      const result = await backendApi.sendInvoice(token, invoice.id, channel);
      const text = `${invoice.number} ${result.queued ? "queued" : "sent"} via ${prettyStatus(channel)}.`;
      setMessage(text);
      setDeliveryStatus({ invoiceId: invoice.id, kind: "success", text });
    } catch (cause) {
      const raw = cause instanceof Error ? cause.message : "Invoice delivery failed.";
      const text = raw.includes("wa_official_not_configured")
        ? "Official WhatsApp is not configured yet. Add Meta token, phone-number ID and public invoice storage in Settings, or use Unofficial WhatsApp."
        : raw.includes("invoice_public_url_unavailable") || raw.includes("invoice_media_url_not_public_https")
          ? "Official WhatsApp needs a public HTTPS invoice PDF URL. Configure Cloudinary/S3 storage, or use Unofficial WhatsApp."
          : prettyStatus(raw);
      setMessage(text);
      setDeliveryStatus({ invoiceId: invoice.id, kind: "error", text });
    } finally {
      setBusyId("");
    }
  };

  const items = archive?.items ?? fallbackItems;
  const summary = archive?.summary ?? {
    totalMinor: fallbackItems.reduce((sum, invoice) => sum + invoice.totalMinor, 0),
    paidMinor: fallbackItems.reduce((sum, invoice) => sum + invoice.paidMinor, 0),
    balanceMinor: fallbackItems.reduce((sum, invoice) => sum + Math.max(0, invoice.totalMinor - invoice.paidMinor), 0),
  };

  return (
    <div className="invoice-archive-view">
      {message && <div className="calendar-message">{message}</div>}
      <section className="invoice-archive-metrics" aria-label="Invoice archive summary">
        <article><small>Matching invoices</small><strong>{archive?.total ?? fallbackItems.length}</strong></article>
        <article><small>Invoice value</small><strong>{money(summary.totalMinor)}</strong></article>
        <article><small>Collected</small><strong>{money(summary.paidMinor)}</strong></article>
        <article><small>Balance</small><strong>{money(summary.balanceMinor)}</strong></article>
      </section>
      <section className="admin-card invoice-archive-card">
        <div className="card-head">
          <div><p className="eyebrow">Stored billing records</p><h2>Invoice archive</h2><p>PDFs are generated once, retained by the backend storage adapter and remain available for accounts and customer delivery.</p></div>
          <button className="button" disabled={loading} onClick={() => void loadArchive(1)}>{loading ? "Loading…" : "Refresh"}</button>
        </div>
        <form className="invoice-archive-filters" onSubmit={(event) => { event.preventDefault(); void loadArchive(1); }}>
          <label className="admin-search-field invoice-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Invoice, customer, phone or email" /></label>
          <label><span>From</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>To</span><input type="date" min={from || undefined} value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">All statuses</option><option value="PAID">Paid</option><option value="PARTIALLY_PAID">Part paid</option><option value="ISSUED">Issued</option><option value="VOID">Void</option></select></label>
          <button className="button admin-primary" type="submit" disabled={loading}>{loading ? "Filtering…" : "Apply filters"}</button>
          {(query || from || to || status) && <button className="button" type="button" onClick={() => { setQuery(""); setFrom(""); setTo(""); setStatus(""); window.setTimeout(() => void backendApi.invoiceArchive(token, { branchId: "main", page: 1, pageSize: 25 }).then(setArchive).catch(() => undefined), 0); }}>Clear</button>}
        </form>
        <div className="invoice-archive-table">
          <header><span>Invoice</span><span>Customer</span><span>Issued</span><span>Total</span><span>Payment</span><span>Actions</span></header>
          {items.map((invoice) => {
            const balance = Math.max(0, invoice.totalMinor - invoice.paidMinor);
            const customer = invoice.customer;
            return (
              <article key={invoice.id}>
                <div><strong>{invoice.number}</strong><span className={`invoice-status status-${invoice.status.toLowerCase().replaceAll("_", "-")}`}>{prettyStatus(invoice.status)}</span></div>
                <div><strong>{customer?.name ?? "Walk-in"}</strong><small>{customer?.phone ?? customer?.email ?? "No contact saved"}</small></div>
                <time>{new Date(invoice.issuedAt ?? invoice.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time>
                <div><strong>{money(invoice.totalMinor)}</strong></div>
                <div><strong>{balance ? `${money(balance)} due` : "Paid"}</strong><small>{money(invoice.paidMinor)} received</small></div>
                <div className="invoice-row-actions">
                  <button disabled={busyId === invoice.id} onClick={() => void openPdf(invoice, false)}>Open PDF</button>
                  <button disabled={busyId === invoice.id} onClick={() => void openPdf(invoice, true)}>Download</button>
                  <button disabled={busyId === invoice.id || !customer?.email} title={customer?.email ? `Send to ${customer.email}` : "Customer email is missing"} onClick={() => void deliver(invoice, "EMAIL")}>Email</button>
                  <button disabled={busyId === invoice.id || !customer?.phone} title={customer?.phone ? `Send to ${customer.phone}` : "Customer phone is missing"} onClick={() => void deliver(invoice, "WHATSAPP_OFFICIAL")}>Official WA</button>
                  <button disabled={busyId === invoice.id || !customer?.phone} title={customer?.phone ? `Send to ${customer.phone}` : "Customer phone is missing"} onClick={() => void deliver(invoice, "WHATSAPP_UNOFFICIAL")}>Unofficial WA</button>
                  {deliveryStatus?.invoiceId === invoice.id && (
                    <p className={`invoice-row-feedback ${deliveryStatus.kind}`} role="status">{deliveryStatus.text}</p>
                  )}
                </div>
              </article>
            );
          })}
          {!items.length && <div className="invoice-archive-empty"><strong>No invoices found</strong><small>Change the date or search filters, or create a bill in Point of sale.</small></div>}
        </div>
        {archive && archive.totalPages > 1 && <footer className="invoice-pagination"><button disabled={loading || archive.page <= 1} onClick={() => void loadArchive(archive.page - 1)}>← Previous</button><span>Page {archive.page} of {archive.totalPages}</span><button disabled={loading || archive.page >= archive.totalPages} onClick={() => void loadArchive(archive.page + 1)}>Next →</button></footer>}
      </section>
    </div>
  );
}

function SystemAndAudit({ token, data }: { token: string; data: BackendSnapshot }) {
  const [healthOverride, setHealth] = useState<BackendSnapshot["systemHealth"]>(null);
  const [logsOverride, setLogs] = useState<BackendSnapshot["auditLogs"] | null>(null);
  const health = healthOverride ?? data.systemHealth;
  const logs = logsOverride ?? data.auditLogs;
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const refresh = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const [nextHealth, nextLogs] = await Promise.all([
        backendApi.systemHealth(token),
        backendApi.auditLogs(token).catch(() => []),
      ]);
      setHealth(nextHealth);
      setLogs(nextLogs);
      setMessage("System checks and audit history refreshed.");
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "System status could not be refreshed.");
    } finally {
      setBusy(false);
    }
  };
  const filtered = logs.filter((item) => `${item.action} ${item.entityType} ${item.entityId} ${item.actor?.email ?? ""}`.toLowerCase().includes(query.toLowerCase()));
  const checks = health ? [
    ["Database", health.checks.database.ok, `${health.checks.database.latencyMs} ms · ${health.checks.database.detail}`],
    ["Redis queue", health.checks.redis.ok, `${health.checks.redis.latencyMs} ms · ${health.checks.redis.detail}`],
    ["SMTP", health.checks.smtp.configured, health.checks.smtp.detail],
    ["WhatsApp official", health.checks.whatsappOfficial.configured, health.checks.whatsappOfficial.detail],
    ["WhatsApp unofficial", health.checks.whatsappUnofficial.configured, health.checks.whatsappUnofficial.configured ? "Connector configured" : "Connector not configured"],
  ] as const : [];
  const security = health ? [
    ["Encrypted provider secrets", health.security.providerSecretsEncrypted],
    ["Login rate limiting", health.security.strictAuthRateLimit],
    ["Security headers", health.security.securityHeaders],
    ["Authenticator 2FA on this account", health.security.authenticator2faEnabled],
    ["Secure password recovery URL", health.security.passwordResetConfigured],
    ["Independent production secret key", health.security.independentSecretsKey],
    ["Explicit production CORS", health.security.explicitCorsAllowlist],
    ["Production mode", health.security.productionMode],
  ] as const : [];
  return (
    <div className="system-view">
      {message && <div className="calendar-message">{message}</div>}
      <div className="system-toolbar">
        <div><p className="eyebrow">Live diagnostics</p><h2>{health?.status === "healthy" ? "Core services healthy" : "System needs attention"}</h2><small>{health ? `Checked ${new Date(health.checkedAt).toLocaleString("en-IN")} · uptime ${Math.floor(health.uptimeSeconds / 3600)}h` : "Connect the backend to run protected checks."}</small></div>
        <button className="button admin-primary" disabled={busy || !token} onClick={() => void refresh()}>{busy ? "Checking…" : "Run health check"}</button>
      </div>
      <div className="system-check-grid">
        {checks.map(([label, ok, detail]) => <article className="admin-card system-check" key={label}><span className={ok ? "ok" : "warn"}>{ok ? "OK" : "!"}</span><div><strong>{label}</strong><small>{detail}</small></div></article>)}
        {!checks.length && <article className="admin-card system-check"><span className="warn">!</span><div><strong>Backend not connected</strong><small>Sign in above to view live infrastructure checks.</small></div></article>}
      </div>
      {health && (
        <article className="admin-card security-card">
          <div className="card-head"><div><h2>Security posture</h2><p>Runtime safeguards and production-only controls.</p></div><span className="count-badge">{health.failures24h.email + health.failures24h.automation}</span></div>
          <div className="security-grid">{security.map(([label, ok]) => <span key={label}><i className={ok ? "ok" : "warn"}>{ok ? "✓" : "!"}</i><strong>{label}</strong></span>)}</div>
          <p className="security-note">Last 24 hours: {health.failures24h.email} failed emails · {health.failures24h.automation} failed automations. Production-only checks remain amber in local development.</p>
        </article>
      )}
      <article className="admin-card audit-card">
        <div className="card-head"><div><h2>Audit log</h2><p>Immutable changes across POS, customers, staff, services, settings and campaigns.</p></div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search action, entity or actor" /></div>
        <div className="audit-table">
          <header><span>When</span><span>Action</span><span>Entity</span><span>Actor</span><span>Source</span></header>
          {filtered.map((item) => <div key={item.id}><time>{new Date(item.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</time><strong>{prettyStatus(item.action.replaceAll(".", "_"))}</strong><span>{item.entityType}<small>{item.entityId}</small></span><span>{item.actor?.email ?? "System"}<small>{item.actor?.role ? prettyStatus(item.actor.role) : "Automation"}</small></span><span>{item.ip ?? "Internal"}</span></div>)}
          {!filtered.length && <p className="empty-cart">No audit entries match this search.</p>}
        </div>
      </article>
    </div>
  );
}

function Settings({
  token,
  data,
  onRefresh,
}: {
  token: string;
  data: BackendSnapshot;
  onRefresh: () => void;
}) {
  const [status, setStatus] = useState<BackendWhatsAppStatus | null>(null);
  const [providerConfig, setProviderConfig] = useState<BackendProviderConfig>({
    smtp: { enabled: false, host: "", port: 587, secure: false, user: "", from: "", hasPassword: false },
    whatsappOfficial: { enabled: false, phoneId: "", wabaId: "", graphVersion: "v23.0", hasToken: false, hasAppSecret: false, hasWebhookVerifyToken: false },
    whatsappUnofficial: {
      enabled: false,
      baseUrl: "",
      callbackUrl: "",
      session: "cutz-bangs-main",
      intervalSeconds: 90,
      dailyCap: 75,
      windowStartHour: 10,
      windowEndHour: 20,
      hasApiKey: false,
      hasWebhookSecret: false,
    },
  });
  const [smtpPassword, setSmtpPassword] = useState("");
  const [officialToken, setOfficialToken] = useState("");
  const [officialAppSecret, setOfficialAppSecret] = useState("");
  const [webhookVerifyToken, setWebhookVerifyToken] = useState("");
  const [wahaApiKey, setWahaApiKey] = useState("");
  const [wahaWebhookSecret, setWahaWebhookSecret] = useState("");
  const [emailTestTo, setEmailTestTo] = useState("");
  const [emailHealth, setEmailHealth] = useState<{ configured: boolean; connected: boolean; detail: string } | null>(null);
  const [bookingInterval, setBookingInterval] = useState(15);
  const [minimumNotice, setMinimumNotice] = useState(2);
  const [allowWaitlist, setAllowWaitlist] = useState(true);
  const [managerOverride, setManagerOverride] = useState(true);
  const [cancellationHours, setCancellationHours] = useState(3);
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(true);
  const [welcomePoints, setWelcomePoints] = useState(50);
  const [earnPoints, setEarnPoints] = useState(1);
  const [earnEveryRupees, setEarnEveryRupees] = useState(100);
  const [redeemRupeesPerPoint, setRedeemRupeesPerPoint] = useState(1);
  const [minimumRedeemPoints, setMinimumRedeemPoints] = useState(50);
  const [inactiveDays, setInactiveDays] = useState(60);
  const [autoInvoiceEmail, setAutoInvoiceEmail] = useState(true);
  const [autoInvoiceWhatsapp, setAutoInvoiceWhatsapp] = useState(false);
  const [invoiceWhatsappChannel, setInvoiceWhatsappChannel] = useState<"WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL">("WHATSAPP_UNOFFICIAL");
  const [invoiceAttachPdf, setInvoiceAttachPdf] = useState(true);
  const [invoiceEmailSubject, setInvoiceEmailSubject] = useState("Your Cutz & Bangs invoice {{invoiceNumber}}");
  const [invoiceEmailBody, setInvoiceEmailBody] = useState("Hi {{name}}, thank you for visiting Cutz & Bangs. Your invoice {{invoiceNumber}} total is {{total}}.");
  const [invoiceWhatsappBody, setInvoiceWhatsappBody] = useState("Thank you {{name}} for visiting Cutz & Bangs. Invoice {{invoiceNumber}} · {{total}}.");
  const [nonReturningEnabled, setNonReturningEnabled] = useState(false);
  const [nonReturningDays, setNonReturningDays] = useState(30);
  const [nonReturningEmail, setNonReturningEmail] = useState(false);
  const [nonReturningWhatsapp, setNonReturningWhatsapp] = useState(true);
  const [nonReturningWhatsappChannel, setNonReturningWhatsappChannel] = useState<"WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL">("WHATSAPP_UNOFFICIAL");
  const [nonReturningTemplate, setNonReturningTemplate] = useState("Hi {{name}}, we have missed you at Cutz & Bangs. It has been {{days}} days since your last visit. Reply BOOK and we will reserve a convenient slot.");
  const [testTo, setTestTo] = useState("");
  const [testMessage, setTestMessage] = useState("Hello from Cutz & Bangs");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [integrationLoading, setIntegrationLoading] = useState(true);
  const [integrationError, setIntegrationError] = useState("");

  const applySettings = (settings: Record<string, unknown>) => {
    const booking = settings.booking as Record<string, unknown> | undefined;
    if (booking) {
      setBookingInterval(Number(booking.intervalMin ?? 15));
      setMinimumNotice(Number(booking.minimumNoticeHours ?? 2));
      setAllowWaitlist(Boolean(booking.allowWaitlist ?? true));
      setManagerOverride(Boolean(booking.managerOverride ?? true));
      setCancellationHours(Number(booking.cancellationHours ?? 3));
    }
    const loyalty = settings.loyalty as Record<string, unknown> | undefined;
    if (loyalty) {
      setLoyaltyEnabled(Boolean(loyalty.enabled ?? true));
      setWelcomePoints(Number(loyalty.welcomePoints ?? 50));
      setEarnPoints(Number(loyalty.earnPoints ?? 1));
      setEarnEveryRupees(Number(loyalty.earnEveryMinor ?? 10_000) / 100);
      setRedeemRupeesPerPoint(Number(loyalty.redeemMinorPerPoint ?? 100) / 100);
      setMinimumRedeemPoints(Number(loyalty.minRedeemPoints ?? 50));
    }
    const retention = settings.retention as Record<string, unknown> | undefined;
    if (retention) setInactiveDays(Number(retention.inactiveDays ?? 60));
    const automation = settings.automation as Record<string, unknown> | undefined;
    if (automation) {
      setAutoInvoiceEmail(Boolean(automation.autoInvoiceEmail ?? true));
      setAutoInvoiceWhatsapp(Boolean(automation.autoInvoiceWhatsapp ?? false));
      setInvoiceWhatsappChannel(automation.invoiceWhatsappChannel === "WHATSAPP_OFFICIAL" ? "WHATSAPP_OFFICIAL" : "WHATSAPP_UNOFFICIAL");
      setInvoiceAttachPdf(Boolean(automation.invoiceAttachPdf ?? true));
      setInvoiceEmailSubject(String(automation.invoiceEmailSubject ?? "Your Cutz & Bangs invoice {{invoiceNumber}}"));
      setInvoiceEmailBody(String(automation.invoiceEmailBody ?? "Hi {{name}}, thank you for visiting Cutz & Bangs. Your invoice {{invoiceNumber}} total is {{total}}."));
      setInvoiceWhatsappBody(String(automation.invoiceWhatsappBody ?? "Thank you {{name}} for visiting Cutz & Bangs. Invoice {{invoiceNumber}} · {{total}}."));
      setNonReturningEnabled(Boolean(automation.nonReturningEnabled ?? false));
      setNonReturningDays(Number(automation.nonReturningDays ?? 30));
      setNonReturningEmail(Boolean(automation.nonReturningEmail ?? false));
      setNonReturningWhatsapp(Boolean(automation.nonReturningWhatsapp ?? true));
      setNonReturningWhatsappChannel(automation.nonReturningWhatsappChannel === "WHATSAPP_OFFICIAL" ? "WHATSAPP_OFFICIAL" : "WHATSAPP_UNOFFICIAL");
      setNonReturningTemplate(String(automation.nonReturningTemplate ?? "Hi {{name}}, we have missed you at Cutz & Bangs. It has been {{days}} days since your last visit. Reply BOOK and we will reserve a convenient slot."));
    }
  };

  const loadIntegrations = async () => {
    if (!token) return;
    setIntegrationLoading(true);
    const results = await Promise.allSettled([
      backendApi.whatsappStatus(token),
      backendApi.branchSettings(token),
      backendApi.providerConfig(token),
      backendApi.emailStatus(token),
    ] as const);
    if (results[0].status === "fulfilled") setStatus(results[0].value);
    if (results[1].status === "fulfilled") applySettings(results[1].value);
    if (results[2].status === "fulfilled") setProviderConfig(results[2].value);
    if (results[3].status === "fulfilled") setEmailHealth(results[3].value);
    const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
    setIntegrationError(failures.length ? failures.map((result) => result.reason instanceof Error ? prettyStatus(result.reason.message) : "Integration check failed").join(" · ") : "");
    setIntegrationLoading(false);
  };
  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    Promise.allSettled([backendApi.whatsappStatus(token), backendApi.branchSettings(token), backendApi.providerConfig(token), backendApi.emailStatus(token)])
      .then((results) => {
        if (cancelled) return;
        if (results[0].status === "fulfilled") setStatus(results[0].value);
        if (results[1].status === "fulfilled") applySettings(results[1].value);
        if (results[2].status === "fulfilled") setProviderConfig(results[2].value);
        if (results[3].status === "fulfilled") setEmailHealth(results[3].value);
        const failures = results.filter((result) => result.status === "rejected") as PromiseRejectedResult[];
        setIntegrationError(failures.length ? failures.map((result) => result.reason instanceof Error ? prettyStatus(result.reason.message) : "Integration check failed").join(" · ") : "");
        setIntegrationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  useEffect(() => {
    if (!token || !status?.unofficial.configured || status.unofficial.connected) return;
    const timer = window.setInterval(() => {
      backendApi.whatsappStatus(token)
        .then(setStatus)
        .catch(() => undefined);
    }, 12_000);
    return () => window.clearInterval(timer);
  }, [status?.unofficial.configured, status?.unofficial.connected, token]);

  const saveBooking = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateBranchSetting(token, "booking", {
        intervalMin: bookingInterval,
        minimumNoticeHours: minimumNotice,
        allowWaitlist,
        managerOverride,
        cancellationHours,
      });
      setMessage("Booking rules saved to the backend.");
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Settings could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const saveLoyalty = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateBranchSetting(token, "loyalty", {
        enabled: loyaltyEnabled,
        welcomePoints,
        earnPoints,
        earnEveryMinor: Math.round(earnEveryRupees * 100),
        redeemMinorPerPoint: Math.round(redeemRupeesPerPoint * 100),
        minRedeemPoints: minimumRedeemPoints,
      });
      setMessage("Loyalty rules saved. New customers and POS bills will use them immediately.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Loyalty rules could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const saveRetention = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateBranchSetting(token, "retention", { inactiveDays });
      setMessage(`Retention threshold saved at ${inactiveDays} days. Dashboard and follow-up lists now use it.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Retention rule could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const automationPayload = () => ({
    autoInvoiceEmail,
    autoInvoiceWhatsapp,
    invoiceWhatsappChannel,
    invoiceAttachPdf,
    invoiceEmailSubject,
    invoiceEmailBody,
    invoiceWhatsappBody,
    nonReturningEnabled,
    nonReturningDays: Math.min(365, Math.max(7, Math.round(nonReturningDays || 30))),
    nonReturningEmail,
    nonReturningWhatsapp,
    nonReturningWhatsappChannel,
    nonReturningTemplate,
  });
  const saveAutomation = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateBranchSetting(token, "automation", automationPayload());
      setMessage("Invoice delivery and customer follow-up automation saved. New POS invoices use these rules immediately.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Automation settings could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const runFollowUpNow = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateBranchSetting(token, "automation", automationPayload());
      const result = await backendApi.runNonReturningAutomation(token);
      setMessage(result.enabled
        ? `${result.eligible} customers matched · ${result.queued} consented deliveries queued · ${result.skippedDuplicate} duplicates safely skipped.`
        : "Non-returning automation is disabled. Turn it on, choose a delivery channel and save the rule first.");
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Follow-up run could not be started.");
    } finally {
      setBusy(false);
    }
  };
  const toggleChannel = async (type: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL", active: boolean) => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.updateChannel(token, type, active);
      await loadIntegrations();
      onRefresh();
      setMessage(`${prettyStatus(type)} ${active ? "enabled" : "disabled"}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Channel could not be updated.");
    } finally {
      setBusy(false);
    }
  };
  const testProvider = async (channel: "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL") => {
    if (!token || !testTo || !testMessage) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.testWhatsApp(token, { channel, to: testTo, message: testMessage });
      setMessage(`Test message sent through ${prettyStatus(channel)}.`);
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Test message failed.");
    } finally {
      setBusy(false);
    }
  };
  const syncTemplates = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await backendApi.syncWhatsAppTemplates(token);
      setMessage(`${result.synced} official WhatsApp templates synced.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Template sync failed.");
    } finally {
      setBusy(false);
    }
  };
  const controlWaha = async (action: "create" | "start" | "restart" | "stop" | "logout") => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const next = await backendApi.controlWahaSession(token, action);
      setStatus((current) => current ? { ...current, unofficial: { ...current.unofficial, ...next } } : current);
      setMessage(action === "create" ? "WAHA session created. Scan the QR below; it refreshes automatically." : `WAHA session ${action} complete.`);
      await loadIntegrations();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "WAHA session action failed.");
    } finally {
      setBusy(false);
    }
  };
  const refreshWahaStatus = async () => {
    if (!token) return;
    setBusy(true);
    setIntegrationError("");
    try {
      const next = await backendApi.whatsappStatus(token);
      setStatus(next);
      setMessage(next.unofficial.connected ? "WAHA is connected; QR stays hidden." : next.unofficial.qrDataUrl ? "Fresh QR loaded. Scan it in WhatsApp → Linked devices." : `WAHA status: ${prettyStatus(next.unofficial.status ?? "unavailable")}.`);
    } catch (cause) {
      const detail = cause instanceof Error ? prettyStatus(cause.message) : "WAHA status could not be loaded.";
      setIntegrationError(detail);
      setMessage(detail);
    } finally {
      setBusy(false);
    }
  };
  const syncWahaContacts = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const result = await backendApi.syncWahaContacts(token);
      setMessage(`${result.fetched} WAHA contacts read, ${result.valid ?? Math.max(0, result.fetched - result.skipped)} usable numbers found. Nothing was added to Customers/CRM.`);
      onRefresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "WAHA contact sync failed.");
    } finally {
      setBusy(false);
    }
  };
  const saveProviders = async () => {
    if (!token) return;
    setBusy(true);
    setMessage("");
    try {
      const saved = await backendApi.saveProviderConfig(token, {
        branchId: "main",
        smtp: {
          enabled: providerConfig.smtp.enabled,
          host: providerConfig.smtp.host,
          port: providerConfig.smtp.port,
          secure: providerConfig.smtp.secure,
          user: providerConfig.smtp.user,
          from: providerConfig.smtp.from,
          ...(smtpPassword ? { password: smtpPassword } : {}),
        },
        whatsappOfficial: {
          enabled: providerConfig.whatsappOfficial.enabled,
          phoneId: providerConfig.whatsappOfficial.phoneId,
          wabaId: providerConfig.whatsappOfficial.wabaId,
          graphVersion: providerConfig.whatsappOfficial.graphVersion,
          ...(officialToken ? { token: officialToken } : {}),
          ...(officialAppSecret ? { appSecret: officialAppSecret } : {}),
          ...(webhookVerifyToken ? { webhookVerifyToken } : {}),
        },
        whatsappUnofficial: {
          enabled: providerConfig.whatsappUnofficial.enabled,
          baseUrl: providerConfig.whatsappUnofficial.baseUrl,
          callbackUrl: providerConfig.whatsappUnofficial.callbackUrl,
          session: providerConfig.whatsappUnofficial.session,
          intervalSeconds: providerConfig.whatsappUnofficial.intervalSeconds,
          dailyCap: providerConfig.whatsappUnofficial.dailyCap,
          windowStartHour: providerConfig.whatsappUnofficial.windowStartHour,
          windowEndHour: providerConfig.whatsappUnofficial.windowEndHour,
          ...(wahaApiKey ? { apiKey: wahaApiKey } : {}),
          ...(wahaWebhookSecret ? { webhookSecret: wahaWebhookSecret } : {}),
        },
      });
      await Promise.all([
        backendApi.updateChannel(token, "EMAIL", saved.smtp.enabled),
        backendApi.updateChannel(token, "WHATSAPP_OFFICIAL", saved.whatsappOfficial.enabled),
        backendApi.updateChannel(token, "WHATSAPP_UNOFFICIAL", saved.whatsappUnofficial.enabled),
      ]);
      setProviderConfig(saved);
      setSmtpPassword("");
      setOfficialToken("");
      setOfficialAppSecret("");
      setWebhookVerifyToken("");
      setWahaApiKey("");
      setWahaWebhookSecret("");
      await loadIntegrations();
      onRefresh();
      setMessage("Email and WhatsApp credentials saved securely and applied to the backend.");
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Provider credentials could not be saved.");
    } finally {
      setBusy(false);
    }
  };
  const testEmail = async () => {
    if (!token || !emailTestTo) return;
    setBusy(true);
    setMessage("");
    try {
      await backendApi.testEmail(token, emailTestTo);
      setMessage(`SMTP test email queued for ${emailTestTo}.`);
      setEmailHealth(await backendApi.emailStatus(token));
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "SMTP test failed.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-stack">
      {message && <div className="calendar-message">{message}</div>}
      {integrationError && <div className="calendar-message error">Some integration checks failed: {integrationError}. Other providers remain usable.</div>}
      <TwoFactorSettings token={token} />
      <article className="admin-card settings-card">
        <p className="eyebrow">Booking rules</p>
        <h2>Availability & scheduling</h2>
        <div className="setting-row">
          <div>
            <strong>Booking interval</strong>
            <small>Start times shown to customers</small>
          </div>
          <select value={bookingInterval} onChange={(event) => setBookingInterval(Number(event.target.value))}>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Minimum notice</strong>
            <small>Prevent last-minute online bookings</small>
          </div>
          <select value={minimumNotice} onChange={(event) => setMinimumNotice(Number(event.target.value))}>
            <option value="1">1 hour</option>
            <option value="2">2 hours</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <strong>Allow waitlist</strong>
            <small>Offer a waitlist when a day is full</small>
          </div>
          <button type="button" className={`toggle ${allowWaitlist ? "active" : ""}`} onClick={() => setAllowWaitlist((current) => !current)}>
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Manager conflict override</strong>
            <small>Require a reason and keep an audit entry</small>
          </div>
          <button type="button" className={`toggle ${managerOverride ? "active" : ""}`} onClick={() => setManagerOverride((current) => !current)}>
            <i />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <strong>Cancellation window</strong>
            <small>Free reschedule before this point</small>
          </div>
          <select value={cancellationHours} onChange={(event) => setCancellationHours(Number(event.target.value))}>
            <option value="3">3 hours</option>
            <option value="6">6 hours</option>
          </select>
        </div>
        <button className="button admin-primary" disabled={busy || !token} onClick={() => void saveBooking()}>{busy ? "Saving…" : "Save booking rules"}</button>
      </article>
      <article className="admin-card settings-card loyalty-settings-card">
        <p className="eyebrow">Loyalty engine</p>
        <h2>Points earning & redemption</h2>
        <div className="setting-row"><div><strong>Loyalty programme</strong><small>Enable automatic earning and POS redemption</small></div><button type="button" className={`toggle ${loyaltyEnabled ? "active" : ""}`} onClick={() => setLoyaltyEnabled((current) => !current)}><i /></button></div>
        <div className="loyalty-rule-grid">
          <label>Welcome points<input type="number" min="0" value={welcomePoints} onChange={(event) => setWelcomePoints(Number(event.target.value))} /></label>
          <label>Earn points<input type="number" min="0" value={earnPoints} onChange={(event) => setEarnPoints(Number(event.target.value))} /></label>
          <label>For every spend (₹)<input type="number" min="1" value={earnEveryRupees} onChange={(event) => setEarnEveryRupees(Number(event.target.value))} /></label>
          <label>Value per point (₹)<input type="number" min="0.01" step="0.01" value={redeemRupeesPerPoint} onChange={(event) => setRedeemRupeesPerPoint(Number(event.target.value))} /></label>
          <label>Minimum redemption<input type="number" min="1" value={minimumRedeemPoints} onChange={(event) => setMinimumRedeemPoints(Number(event.target.value))} /></label>
        </div>
        <p className="loyalty-example">Example: spend ₹{earnEveryRupees.toLocaleString("en-IN")} to earn {earnPoints} point(s); {minimumRedeemPoints} points are worth {money(Math.round(minimumRedeemPoints * redeemRupeesPerPoint * 100))}.</p>
        <button className="button admin-primary" disabled={busy || !token || earnEveryRupees <= 0 || redeemRupeesPerPoint <= 0 || minimumRedeemPoints <= 0} onClick={() => void saveLoyalty()}>{busy ? "Saving…" : "Save loyalty rules"}</button>
      </article>
      <article className="admin-card settings-card retention-settings-card">
        <p className="eyebrow">Customer retention</p>
        <h2>Not-returning customer threshold</h2>
        <p className="loyalty-example">Customers whose last completed visit is older than this threshold appear on the dashboard follow-up list.</p>
        <div className="setting-row"><div><strong>Mark customer inactive after</strong><small>Used by retention KPIs and campaign follow-up</small></div><select value={inactiveDays} onChange={(event) => setInactiveDays(Number(event.target.value))}><option value="30">30 days</option><option value="45">45 days</option><option value="60">60 days</option><option value="90">90 days</option></select></div>
        <button className="button admin-primary" disabled={busy || !token} onClick={() => void saveRetention()}>{busy ? "Saving…" : "Save retention rule"}</button>
      </article>
      <article className="admin-card automation-settings-card">
        <div className="card-head">
          <div>
            <p className="eyebrow">Delivery automation</p>
            <h2>Invoice & customer follow-up</h2>
            <p>Choose what POS sends automatically, then schedule consent-aware messages for customers who have not returned.</p>
          </div>
          <span className={nonReturningEnabled ? "integration-badge connected" : "integration-badge"}>{nonReturningEnabled ? "Follow-up active" : "Manual only"}</span>
        </div>
        <div className="automation-delivery-grid">
          <section className="automation-panel">
            <header><div><strong>After a POS invoice</strong><small>Delivery begins only after the invoice and payment are saved.</small></div></header>
            <div className="automation-toggle-grid">
              <div className="setting-row"><div><strong>Auto email</strong><small>Send to customers with a saved email and consent</small></div><button type="button" aria-label="Toggle automatic invoice email" className={`toggle ${autoInvoiceEmail ? "active" : ""}`} onClick={() => setAutoInvoiceEmail((current) => !current)}><i /></button></div>
              <div className="setting-row"><div><strong>Auto WhatsApp</strong><small>Send to opted-in customers with a phone number</small></div><button type="button" aria-label="Toggle automatic invoice WhatsApp" className={`toggle ${autoInvoiceWhatsapp ? "active" : ""}`} onClick={() => setAutoInvoiceWhatsapp((current) => !current)}><i /></button></div>
              <div className="setting-row"><div><strong>Attach invoice PDF</strong><small>Include the stored PDF with automated delivery</small></div><button type="button" aria-label="Toggle invoice PDF attachment" className={`toggle ${invoiceAttachPdf ? "active" : ""}`} onClick={() => setInvoiceAttachPdf((current) => !current)}><i /></button></div>
            </div>
            <label>WhatsApp provider<select value={invoiceWhatsappChannel} disabled={!autoInvoiceWhatsapp} onChange={(event) => setInvoiceWhatsappChannel(event.target.value as "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL")}><option value="WHATSAPP_OFFICIAL">Official Meta Cloud API</option><option value="WHATSAPP_UNOFFICIAL">Unofficial QR connector</option></select></label>
            <label>Email subject<input value={invoiceEmailSubject} onChange={(event) => setInvoiceEmailSubject(event.target.value)} placeholder="Your invoice {{invoiceNumber}}" /></label>
            <label>Email message<textarea rows={4} value={invoiceEmailBody} onChange={(event) => setInvoiceEmailBody(event.target.value)} /></label>
            <label>WhatsApp message<textarea rows={4} value={invoiceWhatsappBody} onChange={(event) => setInvoiceWhatsappBody(event.target.value)} /></label>
          </section>
          <section className="automation-panel non-returning-panel">
            <header><div><strong>Not-returning customers</strong><small>A customer is selected after the configured number of days without a completed visit.</small></div><button type="button" aria-label="Toggle non-returning customer automation" className={`toggle ${nonReturningEnabled ? "active" : ""}`} onClick={() => setNonReturningEnabled((current) => !current)}><i /></button></header>
            <label>Follow up after<input type="number" min="7" max="365" value={nonReturningDays} onChange={(event) => setNonReturningDays(Math.min(365, Math.max(7, Number(event.target.value) || 7)))} /><small>days since the customer’s last visit</small></label>
            <div className="automation-toggle-grid compact">
              <div className="setting-row"><div><strong>Email</strong><small>Requires email consent</small></div><button type="button" aria-label="Toggle non-returning email" className={`toggle ${nonReturningEmail ? "active" : ""}`} onClick={() => setNonReturningEmail((current) => !current)}><i /></button></div>
              <div className="setting-row"><div><strong>WhatsApp</strong><small>Requires WhatsApp opt-in</small></div><button type="button" aria-label="Toggle non-returning WhatsApp" className={`toggle ${nonReturningWhatsapp ? "active" : ""}`} onClick={() => setNonReturningWhatsapp((current) => !current)}><i /></button></div>
            </div>
            <label>WhatsApp provider<select value={nonReturningWhatsappChannel} disabled={!nonReturningWhatsapp} onChange={(event) => setNonReturningWhatsappChannel(event.target.value as "WHATSAPP_OFFICIAL" | "WHATSAPP_UNOFFICIAL")}><option value="WHATSAPP_OFFICIAL">Official Meta Cloud API</option><option value="WHATSAPP_UNOFFICIAL">Unofficial QR connector</option></select></label>
            <label>Follow-up message<textarea rows={7} value={nonReturningTemplate} onChange={(event) => setNonReturningTemplate(event.target.value)} /></label>
            <p className="automation-safety-note">The backend checks recorded consent, phone/email availability and a 30-day duplicate window before queueing. Unofficial WhatsApp pacing is still controlled by the daily cap and message interval above.</p>
          </section>
        </div>
        <p className="template-variable-note"><strong>Template variables:</strong> <code>{"{{name}}"}</code> <code>{"{{invoiceNumber}}"}</code> <code>{"{{total}}"}</code> <code>{"{{days}}"}</code></p>
        <div className="automation-actions">
          <button className="button admin-primary" disabled={busy || !token || !invoiceEmailSubject.trim() || !invoiceEmailBody.trim() || !invoiceWhatsappBody.trim() || !nonReturningTemplate.trim()} onClick={() => void saveAutomation()}>{busy ? "Saving…" : "Save automation rules"}</button>
          <button className="button" disabled={busy || !token || !nonReturningEnabled || (!nonReturningEmail && !nonReturningWhatsapp)} onClick={() => void runFollowUpNow()}>{busy ? "Running…" : "Run follow-up now"}</button>
        </div>
      </article>
      <article className="admin-card provider-config-card">
        <div className="card-head"><div><p className="eyebrow">Secure email setup</p><h2>SMTP configuration</h2><p>Add or rotate the salon mailbox without editing server files. Passwords are encrypted and never returned to this screen.</p></div><span className={emailHealth?.connected ? "integration-badge connected" : "integration-badge"}>{emailHealth?.connected ? "Connected" : providerConfig.smtp.hasPassword ? "Saved" : "Needs setup"}</span></div>
        <div className="provider-config-form smtp-config-form">
          <label className="toggle-field"><span>Enable email</span><button type="button" className={`toggle ${providerConfig.smtp.enabled ? "active" : ""}`} onClick={() => setProviderConfig((current) => ({ ...current, smtp: { ...current.smtp, enabled: !current.smtp.enabled } }))}><i /></button></label>
          <label>SMTP host<input value={providerConfig.smtp.host} onChange={(event) => setProviderConfig((current) => ({ ...current, smtp: { ...current.smtp, host: event.target.value } }))} placeholder="smtp.example.com" /></label>
          <label>Port<input type="number" min="1" max="65535" value={providerConfig.smtp.port} onChange={(event) => setProviderConfig((current) => ({ ...current, smtp: { ...current.smtp, port: Number(event.target.value) } }))} /></label>
          <label>Username<input value={providerConfig.smtp.user} onChange={(event) => setProviderConfig((current) => ({ ...current, smtp: { ...current.smtp, user: event.target.value } }))} placeholder="salon@example.com" /></label>
          <label>From address<input value={providerConfig.smtp.from} onChange={(event) => setProviderConfig((current) => ({ ...current, smtp: { ...current.smtp, from: event.target.value } }))} placeholder="Cutz & Bangs <salon@example.com>" /></label>
          <label>Password<input type="password" value={smtpPassword} onChange={(event) => setSmtpPassword(event.target.value)} placeholder={providerConfig.smtp.hasPassword ? "Saved · enter only to replace" : "SMTP password"} /></label>
          <label className="toggle-field"><span>Secure TLS socket</span><button type="button" className={`toggle ${providerConfig.smtp.secure ? "active" : ""}`} onClick={() => setProviderConfig((current) => ({ ...current, smtp: { ...current.smtp, secure: !current.smtp.secure } }))}><i /></button></label>
        </div>
        <div className="integration-test-row"><input type="email" value={emailTestTo} onChange={(event) => setEmailTestTo(event.target.value)} placeholder="Test recipient email" /><button disabled={busy || !token || !emailTestTo || !providerConfig.smtp.enabled} onClick={() => void testEmail()}>Send SMTP test</button><small>{emailHealth?.detail ?? "Save credentials, then send a connection test."}</small></div>
      </article>
      <article className="admin-card provider-config-card">
        <div className="card-head"><div><p className="eyebrow">Messaging credentials</p><h2>WhatsApp provider setup</h2><p>Official Meta Cloud API and the optional unofficial connector are isolated from each other.</p></div></div>
        <div className="provider-credential-grid">
          <section>
            <header><div><strong>Official Meta Cloud API</strong><small>Recommended for production messaging</small></div><button type="button" className={`toggle ${providerConfig.whatsappOfficial.enabled ? "active" : ""}`} onClick={() => setProviderConfig((current) => ({ ...current, whatsappOfficial: { ...current.whatsappOfficial, enabled: !current.whatsappOfficial.enabled } }))}><i /></button></header>
            <div className="provider-config-form">
              <label>Phone number ID<input value={providerConfig.whatsappOfficial.phoneId} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappOfficial: { ...current.whatsappOfficial, phoneId: event.target.value } }))} /></label>
              <label>WhatsApp business ID<input value={providerConfig.whatsappOfficial.wabaId} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappOfficial: { ...current.whatsappOfficial, wabaId: event.target.value } }))} /></label>
              <label>Graph API version<input value={providerConfig.whatsappOfficial.graphVersion} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappOfficial: { ...current.whatsappOfficial, graphVersion: event.target.value } }))} placeholder="v23.0" /></label>
              <label>Permanent access token<input type="password" value={officialToken} onChange={(event) => setOfficialToken(event.target.value)} placeholder={providerConfig.whatsappOfficial.hasToken ? "Saved · enter only to replace" : "Meta access token"} /></label>
              <label>App secret<input type="password" value={officialAppSecret} onChange={(event) => setOfficialAppSecret(event.target.value)} placeholder={providerConfig.whatsappOfficial.hasAppSecret ? "Saved · enter only to replace" : "Meta app secret"} /></label>
              <label>Webhook verify token<input type="password" value={webhookVerifyToken} onChange={(event) => setWebhookVerifyToken(event.target.value)} placeholder={providerConfig.whatsappOfficial.hasWebhookVerifyToken ? "Saved · enter only to replace" : "At least 12 characters"} /></label>
            </div>
            <small className="webhook-hint">Webhook endpoint: <code>/api/v1/webhooks/whatsapp</code></small>
          </section>
          <section>
            <header><div><strong>WAHA · self-hosted unofficial API</strong><small>Free/open-source connector on an isolated private service</small></div><button type="button" className={`toggle ${providerConfig.whatsappUnofficial.enabled ? "active" : ""}`} onClick={() => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, enabled: !current.whatsappUnofficial.enabled } }))}><i /></button></header>
            <div className="provider-config-form">
              <label>WAHA base URL<input value={providerConfig.whatsappUnofficial.baseUrl} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, baseUrl: event.target.value } }))} placeholder="http://waha:3000" /></label>
              <label>Backend webhook URL<input value={providerConfig.whatsappUnofficial.callbackUrl} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, callbackUrl: event.target.value } }))} placeholder="https://salon.example.com/api/v1/webhooks/whatsapp/unofficial" /></label>
              <label>Session name<input value={providerConfig.whatsappUnofficial.session} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, session: event.target.value } }))} placeholder="cutz-bangs-main" /></label>
              <label>WAHA API key<input type="password" value={wahaApiKey} onChange={(event) => setWahaApiKey(event.target.value)} placeholder={providerConfig.whatsappUnofficial.hasApiKey ? "Saved · enter only to replace" : "At least 24 characters"} /></label>
              <label>Webhook secret<input type="password" value={wahaWebhookSecret} onChange={(event) => setWahaWebhookSecret(event.target.value)} placeholder={providerConfig.whatsappUnofficial.hasWebhookSecret ? "Saved · enter only to replace" : "Separate 24+ character secret"} /></label>
              <label>Seconds between messages<select value={providerConfig.whatsappUnofficial.intervalSeconds} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, intervalSeconds: Number(event.target.value) } }))}><option value="60">60 seconds</option><option value="90">90 seconds · recommended</option><option value="120">120 seconds</option><option value="180">180 seconds</option></select></label>
              <label>Daily recipient cap<input type="number" min="5" max="200" value={providerConfig.whatsappUnofficial.dailyCap} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, dailyCap: Number(event.target.value) } }))} /></label>
              <label>Send from hour<input type="number" min="0" max="22" value={providerConfig.whatsappUnofficial.windowStartHour} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, windowStartHour: Number(event.target.value) } }))} /></label>
              <label>Send until hour<input type="number" min="1" max="23" value={providerConfig.whatsappUnofficial.windowEndHour} onChange={(event) => setProviderConfig((current) => ({ ...current, whatsappUnofficial: { ...current.whatsappUnofficial, windowEndHour: Number(event.target.value) } }))} /></label>
            </div>
            <p className="provider-warning">Unofficial access can still be restricted or banned. Pacing reduces burst volume; it does not make bulk messaging safe or compliant. Only message people with recorded opt-in.</p>
          </section>
        </div>
        <button className="button admin-primary" disabled={busy || !token} onClick={() => void saveProviders()}>{busy ? "Saving…" : "Save & apply provider credentials"}</button>
      </article>
      <article className="admin-card whatsapp-settings">
        <div className="card-head"><div><p className="eyebrow">Provider adapters</p><h2>WhatsApp integrations</h2><p>Official Cloud API and the isolated unofficial QR session stay separate.</p></div></div>
        <div className="whatsapp-provider-grid">
          {(["official", "unofficial"] as const).map((key) => {
            const item = status?.[key];
            const type = key === "official" ? "WHATSAPP_OFFICIAL" : "WHATSAPP_UNOFFICIAL";
            const technicalStatus = key === "unofficial" ? status?.unofficial.status : undefined;
            const hasQr = key === "unofficial" && Boolean(status?.unofficial.qrDataUrl);
            const sessionNeedsCreate = key === "unofficial" && ["NOT_CONFIGURED", "UNAVAILABLE", "STOPPED"].includes(technicalStatus ?? "");
            return (
              <section key={key} className="provider-card">
                <header><div><strong>{key === "official" ? "Official Meta Cloud API" : "Unofficial QR connector"}</strong><small>{item?.detail ?? (integrationLoading ? "Checking live backend…" : integrationError || "Status unavailable — run check again")}</small>{technicalStatus && <em className="provider-technical-status">{technicalStatus}</em>}</div><span className={item?.connected ? "connected" : "offline"}>{item?.connected ? "Connected" : item?.configured ? hasQr ? "Scan QR" : "Configured" : "Needs setup"}</span></header>
                {key === "unofficial" && item?.connected && (
                  <div className="waha-connected"><b>✓ Connected</b><span>{item.accountName || "WhatsApp account"}{item.accountNumber ? ` · +${item.accountNumber}` : ""}</span><small>QR is hidden while the session is working.</small></div>
                )}
                {key === "unofficial" && !item?.connected && item?.qrDataUrl && <Image key={item.qrDataUrl.slice(-24)} src={item.qrDataUrl} alt="Scan to link the WAHA WhatsApp session" width={240} height={240} unoptimized />}
                {key === "unofficial" && item?.risk && (
                  <div className={`wa-risk wa-risk-${item.risk.label}`}>
                    <div><strong>{item.risk.score}/100</strong><span>{prettyStatus(item.risk.label)} account-risk signal</span></div>
                    <progress max="100" value={item.risk.score} />
                    <small>Heuristic, not a ban probability · {item.risk.safeguards.intervalSeconds}s spacing · {item.risk.safeguards.dailyCap}/day · {item.risk.safeguards.deliveryWindow}</small>
                  </div>
                )}
                <div className="provider-actions">
                  <button type="button" className={`toggle ${item?.active ? "active" : ""}`} disabled={busy || !token} onClick={() => void toggleChannel(type, !item?.active)}><i /></button>
                  {key === "official" && <button disabled={busy || !token} onClick={() => void syncTemplates()}>Sync templates</button>}
                  {key === "unofficial" && !item?.connected && !sessionNeedsCreate && <button disabled={busy || !token || !providerConfig.whatsappUnofficial.enabled} onClick={() => void refreshWahaStatus()}>Show / refresh QR</button>}
                  {key === "unofficial" && !item?.connected && sessionNeedsCreate && <button disabled={busy || !token || !providerConfig.whatsappUnofficial.enabled} onClick={() => void controlWaha(technicalStatus === "STOPPED" ? "start" : "create")}>{technicalStatus === "STOPPED" ? "Start session" : "Create session"}</button>}
                  {key === "unofficial" && item?.connected && <button disabled={busy || !token} onClick={() => void syncWahaContacts()}>Preview contacts</button>}
                  {key === "unofficial" && item?.configured && technicalStatus !== "SCAN_QR_CODE" && <button disabled={busy || !token} onClick={() => void controlWaha("restart")}>Restart</button>}
                  {key === "unofficial" && item?.connected && <button disabled={busy || !token} onClick={() => void controlWaha("logout")}>Disconnect</button>}
                  <button disabled={busy || !token || !testTo || !testMessage} onClick={() => void testProvider(type)}>Send test</button>
                </div>
              </section>
            );
          })}
        </div>
        <div className="whatsapp-test-row"><input value={testTo} onChange={(event) => setTestTo(event.target.value)} placeholder="Recipient with country code" /><input value={testMessage} onChange={(event) => setTestMessage(event.target.value)} placeholder="Test message" /></div>
        <small>{status ? "Live provider status loaded" : "Provider status not loaded"} · {data.channels.filter((channel) => channel.type.startsWith("WHATSAPP")).length} WhatsApp channel records · credentials remain server-side.</small>
      </article>
    </div>
  );
}

function TwoFactorSettings({ token }: { token: string }) {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof backendApi.twoFactorStatus>> | null>(null);
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof backendApi.setupTwoFactor>> | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const loadStatus = async () => {
    if (token) setStatus(await backendApi.twoFactorStatus(token));
  };

  useEffect(() => {
    let cancelled = false;
    if (!token) return;
    backendApi.twoFactorStatus(token)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch((cause) => { if (!cancelled) setMessage(cause instanceof Error ? prettyStatus(cause.message) : "2FA status unavailable."); });
    return () => { cancelled = true; };
  }, [token]);

  const beginSetup = async () => {
    setBusy(true); setMessage(""); setRecoveryCodes([]);
    try {
      setSetup(await backendApi.setupTwoFactor(token));
      setCode("");
      setMessage("Scan the QR, then enter the current six-digit code to confirm.");
      await loadStatus();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "2FA setup could not start.");
    } finally { setBusy(false); }
  };

  const enable = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await backendApi.enableTwoFactor(token, code);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null); setCode("");
      setMessage("Two-step verification is active. Save the one-time recovery codes now.");
      await loadStatus();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Authenticator code could not be verified.");
    } finally { setBusy(false); }
  };

  const rotateRecoveryCodes = async () => {
    setBusy(true); setMessage("");
    try {
      const result = await backendApi.rotateTwoFactorRecoveryCodes(token, password, code);
      setRecoveryCodes(result.recoveryCodes); setPassword(""); setCode("");
      setMessage("Old recovery codes were revoked. Save the new codes now.");
      await loadStatus();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Recovery codes could not be rotated.");
    } finally { setBusy(false); }
  };

  const disable = async () => {
    setBusy(true); setMessage("");
    try {
      await backendApi.disableTwoFactor(token, { password, code });
      setPassword(""); setCode(""); setRecoveryCodes([]); setSetup(null);
      setMessage("Two-step verification has been disabled. Other signed-in devices were revoked.");
      await loadStatus();
    } catch (cause) {
      setMessage(cause instanceof Error ? prettyStatus(cause.message) : "Two-step verification could not be disabled.");
    } finally { setBusy(false); }
  };

  const copyRecoveryCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join("\n"));
      setMessage("Recovery codes copied. Store them outside this device.");
    } catch {
      setMessage("Copy was blocked by the browser. Select and save each code manually.");
    }
  };

  return (
    <article className="admin-card provider-config-card two-factor-card">
      <div className="card-head">
        <div><p className="eyebrow">Account security</p><h2>Google Authenticator-compatible 2FA</h2><p>Password login plus a time-based one-time code. Secrets are encrypted; recovery codes are stored only as hashes.</p></div>
        <span className={status?.enabled ? "integration-badge connected" : "integration-badge"}>{status?.enabled ? "Protected" : status ? "Not enabled" : "Checking…"}</span>
      </div>
      {!status?.enabled && !setup && (
        <div className="two-factor-intro"><div><strong>Add a second sign-in step</strong><small>Works with Google Authenticator, Microsoft Authenticator, 1Password and compatible TOTP apps.</small></div><button className="button admin-primary" disabled={busy || !token} onClick={() => void beginSetup()}>{busy ? "Preparing…" : status?.setupPending ? "Restart secure setup" : "Set up authenticator"}</button></div>
      )}
      {setup && !status?.enabled && (
        <div className="two-factor-setup">
          <Image src={setup.qrDataUrl} alt="QR code for authenticator setup" width={280} height={280} unoptimized />
          <div><strong>1. Scan this QR in your authenticator app</strong><small>If scanning is unavailable, enter this manual key:</small><code>{setup.manualKey}</code><label>2. Enter the current 6-digit code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} placeholder="000000" /></label><button className="button admin-primary" disabled={busy || code.length !== 6} onClick={() => void enable()}>{busy ? "Verifying…" : "Verify & enable 2FA"}</button></div>
        </div>
      )}
      {status?.enabled && !recoveryCodes.length && (
        <div className="two-factor-enabled">
          <div><strong>✓ Two-step verification is active</strong><small>{status.recoveryCodesRemaining} unused recovery codes remain. Enter your password and current authenticator code to rotate codes or disable protection.</small></div>
          <div className="two-factor-sensitive-fields"><label>Password<input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>Authenticator code<input inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/gu, "").slice(0, 6))} /></label></div>
          <div className="provider-actions"><button disabled={busy || !password || code.length !== 6} onClick={() => void rotateRecoveryCodes()}>Generate new recovery codes</button><button className="danger-action" disabled={busy || !password || code.length !== 6} onClick={() => void disable()}>Disable 2FA</button></div>
        </div>
      )}
      {recoveryCodes.length > 0 && (
        <div className="recovery-code-panel"><div><strong>Save these one-time recovery codes</strong><small>Each code works once. They will not be shown again after you leave or generate a new set.</small></div><div className="recovery-code-grid">{recoveryCodes.map((item) => <code key={item}>{item}</code>)}</div><button onClick={() => void copyRecoveryCodes()}>Copy all codes</button></div>
      )}
      {message && <p className="two-factor-message" role="status">{message}</p>}
    </article>
  );
}
