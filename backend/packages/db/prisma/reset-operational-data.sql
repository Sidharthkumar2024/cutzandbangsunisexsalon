-- Production-safe operational reset for Cutz & Bangs.
-- Preserves identities/customers/staff, service catalog and required tenant/provider configuration.
-- Invoices are deliberately removed at the owner's request.
-- Run only after a full pg_dump backup.

BEGIN;

-- Remove invoice-linked records before invoices (financial history is not retained).
DELETE FROM "InvoiceRefundItem";
DELETE FROM "InvoiceRefund";
DELETE FROM "Payment";
DELETE FROM "CouponRedemption";
DELETE FROM "Invoice";

-- Marketing, messaging and automation history.
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

-- Booking and day-to-day staff activity. Staff identities and service mappings remain.
DELETE FROM "Appointment";
DELETE FROM "Waitlist";
DELETE FROM "Attendance";
DELETE FROM "Leave";
DELETE FROM "StaffInvite";
DELETE FROM "BiometricDevice";

-- Membership, reward, coupon and package state.
DELETE FROM "MembershipLedger";
DELETE FROM "Membership";
DELETE FROM "MembershipPlan";
DELETE FROM "ServicePackageLedger";
DELETE FROM "CustomerServicePackage";
DELETE FROM "ServicePackageItem";
DELETE FROM "ServicePackagePlan";
DELETE FROM "WalletLedger";
DELETE FROM "LoyaltyLedger";
DELETE FROM "CouponRedemption";
DELETE FROM "Coupon";
UPDATE "Customer" SET "loyaltyPoints" = 0;

-- Inventory, cash drawer and imported operational summaries.
DELETE FROM "InventoryMovement";
DELETE FROM "PurchaseItem";
DELETE FROM "PurchaseBill";
DELETE FROM "Vendor";
DELETE FROM "Product";
DELETE FROM "Expense";
DELETE FROM "CashSession";
DELETE FROM "HistoricalDailySummary";
DELETE FROM "PaymentReconciliation";

-- Imported/manual visit notes and stale authentication artefacts.
DELETE FROM "CustomerHistoryEntry";
DELETE FROM "PasswordResetToken";
DELETE FROM "Session";

COMMIT;
