CREATE TABLE `membership_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tagline` text NOT NULL,
	`pay_amount` integer NOT NULL,
	`credit_amount` integer NOT NULL,
	`validity_months` integer,
	`description` text NOT NULL,
	`perks_json` text NOT NULL,
	`theme` text DEFAULT 'cream' NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_featured` integer DEFAULT false NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `site_services` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`category` text NOT NULL,
	`description` text NOT NULL,
	`price_inr` integer NOT NULL,
	`duration_minutes` integer NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `testimonials` (
	`id` text PRIMARY KEY NOT NULL,
	`quote` text NOT NULL,
	`customer_name` text NOT NULL,
	`customer_detail` text NOT NULL,
	`rating` integer DEFAULT 5 NOT NULL,
	`display_order` integer DEFAULT 0 NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`updated_at` text NOT NULL
);
