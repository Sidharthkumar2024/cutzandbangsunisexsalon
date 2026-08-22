CREATE INDEX `idx_membership_plans_active_order` ON `membership_plans` (`is_active`,`display_order`);--> statement-breakpoint
CREATE INDEX `idx_site_services_active_order` ON `site_services` (`is_active`,`display_order`);--> statement-breakpoint
CREATE INDEX `idx_testimonials_active_order` ON `testimonials` (`is_active`,`display_order`);
--> statement-breakpoint
PRAGMA optimize;
