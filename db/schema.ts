import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const siteServices = sqliteTable('site_services', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  priceInr: integer('price_inr').notNull(),
  durationMinutes: integer('duration_minutes').notNull(),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
}, table => [index('idx_site_services_active_order').on(table.isActive, table.displayOrder)]);

export const testimonials = sqliteTable('testimonials', {
  id: text('id').primaryKey(),
  quote: text('quote').notNull(),
  customerName: text('customer_name').notNull(),
  customerDetail: text('customer_detail').notNull(),
  rating: integer('rating').notNull().default(5),
  displayOrder: integer('display_order').notNull().default(0),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
}, table => [index('idx_testimonials_active_order').on(table.isActive, table.displayOrder)]);

export const membershipPlans = sqliteTable('membership_plans', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tagline: text('tagline').notNull(),
  payAmount: integer('pay_amount').notNull(),
  creditAmount: integer('credit_amount').notNull(),
  validityMonths: integer('validity_months'),
  description: text('description').notNull(),
  perksJson: text('perks_json').notNull(),
  theme: text('theme').notNull().default('cream'),
  displayOrder: integer('display_order').notNull().default(0),
  isFeatured: integer('is_featured', { mode: 'boolean' }).notNull().default(false),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
}, table => [index('idx_membership_plans_active_order').on(table.isActive, table.displayOrder)]);
