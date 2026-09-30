-- Owner-authorized operational reset for Cutz & Bangs.
-- Keeps only the usable account/catalog foundation: User, Tenant/Branch access,
-- Service and ServiceCategory. All customer, financial, campaign, staff and
-- provider-configuration data is permanently removed. Run only after pg_dump.

BEGIN;

-- Financial and POS history.
DELETE FROM "InvoiceRefundItem";
DELETE FROM "InvoiceRefund";
DELETE FROM "Payment";
DELETE FROM "CouponRedemption";
DELETE FROM "InvoiceItem";
DELETE FROM "Invoice";
DELETE FROM "PaymentReconciliation";
DELETE FROM "CashSession";

-- Campaigns, conversations, delivery history and media.
DELETE FROM "CampaignRecipient";
DELETE FROM "Campaign";
DELETE FROM "Attachment";
DELETE FROM "Message";
DELETE FROM "Conversation";
DELETE FROM "Template";
DELETE FROM "AutomationRun";
DELETE FROM "AutomationRule";
DELETE FROM "Notification";
DELETE FROM "EmailLog";
DELETE FROM "AuditLog";

-- Appointments and waiting list.
DELETE FROM "AppointmentEvent";
DELETE FROM "AppointmentItem";
DELETE FROM "Appointment";
DELETE FROM "Waitlist";

-- Memberships, rewards, packages, coupons and customer records.
DELETE FROM "MembershipLedger";
DELETE FROM "Membership";
DELETE FROM "MembershipPlan";
DELETE FROM "ServicePackageLedger";
DELETE FROM "CustomerServicePackage";
DELETE FROM "ServicePackageItem";
DELETE FROM "ServicePackagePlan";
DELETE FROM "WalletLedger";
DELETE FROM "LoyaltyLedger";
DELETE FROM "Coupon";
DELETE FROM "CustomerCompanion";
DELETE FROM "CustomerHistoryEntry";
DELETE FROM "Customer";

-- Staff and all staff-specific operational data. User accounts remain intact.
DELETE FROM "StaffInvite";
DELETE FROM "StaffSkill";
DELETE FROM "ServiceStaff";
DELETE FROM "Shift";
DELETE FROM "Leave";
DELETE FROM "Attendance";
DELETE FROM "BiometricDevice";
DELETE FROM "Staff";

-- Inventory, suppliers and operational reports.
DELETE FROM "InventoryMovement";
DELETE FROM "PurchaseItem";
DELETE FROM "PurchaseBill";
DELETE FROM "Vendor";
DELETE FROM "Product";
DELETE FROM "Expense";
DELETE FROM "HistoricalDailySummary";

-- Remove old API/provider configuration and all non-essential app settings.
DELETE FROM "TenantProviderSetting";
DELETE FROM "Setting";

-- Existing sessions are intentionally invalidated after the reset.
DELETE FROM "PasswordResetToken";
DELETE FROM "Session";

COMMIT;
