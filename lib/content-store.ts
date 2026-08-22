import { env } from 'cloudflare:workers';
import { defaultSiteContent } from './content-defaults';
import type { FeaturedService, MembershipPlan, SiteContent, Testimonial } from './content-types';

const tableStatements = [
  `CREATE TABLE IF NOT EXISTS site_services (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    price_inr INTEGER NOT NULL,
    duration_minutes INTEGER NOT NULL,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS testimonials (
    id TEXT PRIMARY KEY NOT NULL,
    quote TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    customer_detail TEXT NOT NULL,
    rating INTEGER NOT NULL DEFAULT 5,
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS membership_plans (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    pay_amount INTEGER NOT NULL,
    credit_amount INTEGER NOT NULL,
    validity_months INTEGER,
    description TEXT NOT NULL,
    perks_json TEXT NOT NULL,
    theme TEXT NOT NULL DEFAULT 'cream',
    display_order INTEGER NOT NULL DEFAULT 0,
    is_featured INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  'CREATE INDEX IF NOT EXISTS idx_site_services_active_order ON site_services(is_active, display_order)',
  'CREATE INDEX IF NOT EXISTS idx_testimonials_active_order ON testimonials(is_active, display_order)',
  'CREATE INDEX IF NOT EXISTS idx_membership_plans_active_order ON membership_plans(is_active, display_order)',
];

function database() {
  return env.DB as D1Database;
}

async function ensureSchema(db: D1Database) {
  await db.batch(tableStatements.map(statement => db.prepare(statement)));
}

async function seedDefaults(db: D1Database) {
  const counts = await db.batch([
    db.prepare('SELECT COUNT(*) AS count FROM site_services'),
    db.prepare('SELECT COUNT(*) AS count FROM testimonials'),
    db.prepare('SELECT COUNT(*) AS count FROM membership_plans'),
  ]);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [];
  if (Number(counts[0].results[0]?.count ?? 0) === 0) {
    for (const item of defaultSiteContent.services) statements.push(serviceInsert(db, item, now));
  }
  if (Number(counts[1].results[0]?.count ?? 0) === 0) {
    for (const item of defaultSiteContent.testimonials) statements.push(testimonialInsert(db, item, now));
  }
  if (Number(counts[2].results[0]?.count ?? 0) === 0) {
    for (const item of defaultSiteContent.membershipPlans) statements.push(membershipInsert(db, item, now));
  }
  if (statements.length) await db.batch(statements);
}

function serviceInsert(db: D1Database, item: FeaturedService, now: string) {
  return db.prepare('INSERT INTO site_services (id, name, category, description, price_inr, duration_minutes, display_order, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(item.id, item.name, item.category, item.description, item.priceInr, item.durationMinutes, item.displayOrder, item.isActive ? 1 : 0, now);
}

function testimonialInsert(db: D1Database, item: Testimonial, now: string) {
  return db.prepare('INSERT INTO testimonials (id, quote, customer_name, customer_detail, rating, display_order, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(item.id, item.quote, item.customerName, item.customerDetail, item.rating, item.displayOrder, item.isActive ? 1 : 0, now);
}

function membershipInsert(db: D1Database, item: MembershipPlan, now: string) {
  return db.prepare('INSERT INTO membership_plans (id, name, tagline, pay_amount, credit_amount, validity_months, description, perks_json, theme, display_order, is_featured, is_active, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(item.id, item.name, item.tagline, item.payAmount, item.creditAmount, item.validityMonths, item.description, JSON.stringify(item.perks), item.theme, item.displayOrder, item.isFeatured ? 1 : 0, item.isActive ? 1 : 0, now);
}

export async function getSiteContent(): Promise<SiteContent> {
  try {
    const db = database();
    await ensureSchema(db);
    await seedDefaults(db);
    const [services, testimonials, memberships] = await db.batch([
      db.prepare('SELECT * FROM site_services WHERE is_active = 1 ORDER BY display_order ASC, name ASC'),
      db.prepare('SELECT * FROM testimonials WHERE is_active = 1 ORDER BY display_order ASC, customer_name ASC'),
      db.prepare('SELECT * FROM membership_plans WHERE is_active = 1 ORDER BY display_order ASC, name ASC'),
    ]);
    return {
      services: services.results.map(row => ({ id: String(row.id), name: String(row.name), category: String(row.category), description: String(row.description), priceInr: Number(row.price_inr), durationMinutes: Number(row.duration_minutes), displayOrder: Number(row.display_order), isActive: Boolean(row.is_active) })),
      testimonials: testimonials.results.map(row => ({ id: String(row.id), quote: String(row.quote), customerName: String(row.customer_name), customerDetail: String(row.customer_detail), rating: Number(row.rating), displayOrder: Number(row.display_order), isActive: Boolean(row.is_active) })),
      membershipPlans: memberships.results.map(row => ({ id: String(row.id), name: String(row.name), tagline: String(row.tagline), payAmount: Number(row.pay_amount), creditAmount: Number(row.credit_amount), validityMonths: row.validity_months === null ? null : Number(row.validity_months), description: String(row.description), perks: JSON.parse(String(row.perks_json)) as string[], theme: String(row.theme) as MembershipPlan['theme'], displayOrder: Number(row.display_order), isFeatured: Boolean(row.is_featured), isActive: Boolean(row.is_active) })),
    };
  } catch (error) {
    console.error('Content store fallback:', error);
    return structuredClone(defaultSiteContent);
  }
}

export async function replaceSiteContent(content: SiteContent): Promise<SiteContent> {
  const db = database();
  await ensureSchema(db);
  const now = new Date().toISOString();
  const statements: D1PreparedStatement[] = [
    db.prepare('DELETE FROM site_services'),
    db.prepare('DELETE FROM testimonials'),
    db.prepare('DELETE FROM membership_plans'),
  ];
  content.services.forEach((item, index) => statements.push(serviceInsert(db, { ...item, displayOrder: index }, now)));
  content.testimonials.forEach((item, index) => statements.push(testimonialInsert(db, { ...item, displayOrder: index }, now)));
  content.membershipPlans.forEach((item, index) => statements.push(membershipInsert(db, { ...item, displayOrder: index }, now)));
  await db.batch(statements);
  return getSiteContent();
}

export async function getResolvedSiteContent(): Promise<SiteContent> {
  const endpoint = process.env.CONTENT_API_URL?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, { headers: { Accept: 'application/json' }, cache: 'no-store' });
      if (!response.ok) throw new Error(`Cloud content API returned ${response.status}`);
      const remote = await response.json() as SiteContent;
      await replaceSiteContent(remote);
      return remote;
    } catch (error) {
      console.error('Cloud content API fallback:', error);
    }
  }
  return getSiteContent();
}

export async function replaceResolvedSiteContent(content: SiteContent): Promise<SiteContent> {
  const endpoint = process.env.CONTENT_API_URL?.trim();
  if (endpoint) {
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(content),
      });
      if (!response.ok) throw new Error(`Cloud content API returned ${response.status}`);
      const remote = await response.json() as SiteContent;
      await replaceSiteContent(remote);
      return remote;
    } catch (error) {
      console.error('Cloud content API write fallback:', error);
    }
  }
  return replaceSiteContent(content);
}
