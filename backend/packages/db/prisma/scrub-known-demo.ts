import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const CONFIRMATION = "CUTZ_BANGS_REMOVE_KNOWN_DEMO";
const demoNames = new Set([
  "demo customer", "test customer", "asha demo", "phase one demo", "invoice test",
  "expiry test", "loyalty verification", "coupon refund", "member refund2", "owner a", "victim b",
  "gst coupon", "rebook cust", "no history", "website chat verification", "legacy import verification",
  "whatsapp contact", "test cust", "priya sharma", "test guest", "test user", "vip override",
  "neha verma", "curl test", "online phase one demo", "sam roy", "browser e2e", "hdr test",
  "reschedule me", "proxy path", "cors check", "waiting wanda", "cors star", "hdr full",
  "clean proc", "smoke", "als smoke",
]);
const demoSources = ["demo", "seed", "test"];
const demoMembershipPlanNames = ["E2E Flexible Membership", "Pay 3000 get 5000"];
const demoPackageNames = ["E2E Grooming Pack"];
const demoProductNames = ["E2E Serum 1787402424", "Gift Box", "Serum 50ml", "Shampoo 250ml", "Wax Strips"];
const demoServiceNames = ["Haircut", "Classic pedicure"];
const temporaryCashOpeningNotes = ["Codex UI verification"];
const inactiveDemoStaffNames = ["Asha", "Riya Sen", "Arjun Khanna", "Meher Malik"];
const standaloneDemoUserEmails = ["test138263@example.com"];

function isKnownDemoCustomer(customer: { name: string; phone: string | null; email: string | null; source: string | null; deletedAt: Date | null }) {
  const name = customer.name.trim().toLocaleLowerCase("en-IN");
  if (
    demoNames.has(name)
    || /^(?:e2e customer|test cust|loyalty verification)(?:\b|[-_ ])/i.test(customer.name)
  ) return true;
  // Only treat an impossible-length phone as synthetic when the accompanying
  // name is itself explicitly test-like. This intentionally avoids broad
  // deletion of real customers with malformed legacy phone formatting.
  const phoneDigits = customer.phone?.replace(/\D/g, "") ?? "";
  if (phoneDigits.length > 15 && /(?:test|demo|verification|whatsapp contact)/i.test(customer.name)) return true;
  // Ravi Kumar is a plausible real name, so it is never sufficient by itself.
  return name === "ravi kumar" && (
    (phoneDigits === "9990001111" && (customer.email ?? "").toLowerCase() === "ravi@example.com")
    || phoneDigits.length > 15
    || /(?:^|[.@_-])(?:test|demo|seed)(?:[.@_-]|$)/i.test(customer.email ?? "")
    || (customer.email ?? "").toLowerCase().endsWith("@cutzbangs.local")
    || (customer.deletedAt !== null && customer.phone === null && customer.email === null)
  );
}

async function main() {
  const placeholderUsers = await prisma.user.findMany({
    where: { OR: [{ email: { endsWith: "@cutzbangs.local" } }, { email: { in: standaloneDemoUserEmails } }] },
    select: { id: true, email: true },
  });
  const placeholderUserIds = placeholderUsers.map((user) => user.id);
  const customerCandidates = await prisma.customer.findMany({
    select: { id: true, name: true, phone: true, email: true, source: true, deletedAt: true },
  });
  const demoCustomers = customerCandidates.filter((customer) =>
    isKnownDemoCustomer(customer) || demoSources.includes(customer.source?.toLocaleLowerCase("en-IN") ?? ""),
  );
  const customerIds = demoCustomers.map((customer) => customer.id);
  const customerIdSet = new Set(customerIds);
  const appointmentCandidates = await prisma.appointment.findMany({ select: { id: true, customerId: true, guestName: true, startAt: true, status: true } });
  const demoAppointments = appointmentCandidates.filter((appointment) => {
    if (appointment.customerId && customerIdSet.has(appointment.customerId)) return true;
    const guestName = appointment.guestName.trim().toLocaleLowerCase("en-IN");
    return demoNames.has(guestName) || /^e2e customer(?:\b|[-_ ])/i.test(appointment.guestName);
  });
  const appointmentIds = demoAppointments.map((appointment) => appointment.id);
  const demoInvoices = await prisma.invoice.findMany({
    where: { OR: [
      { customerId: { in: customerIds } },
      { appointmentId: { in: appointmentIds } },
      { payments: { some: { createdByUserId: { in: placeholderUserIds } } } },
      { number: { startsWith: "DEMO-" } },
      { number: { startsWith: "TEST-" } },
    ] },
    select: { id: true, number: true, customerId: true, appointmentId: true, totalMinor: true, status: true },
  });
  const invoiceIds = demoInvoices.map((invoice) => invoice.id);
  const demoExpenses = await prisma.expense.findMany({
    where: { OR: [{ source: { in: demoSources, mode: "insensitive" } }, { createdByUserId: { in: placeholderUserIds } }] },
    select: { id: true, description: true, amountMinor: true, occurredAt: true, source: true, createdByUserId: true },
  });
  const demoCashSessions = await prisma.cashSession.findMany({ where: { openedByUserId: { in: placeholderUserIds } }, select: { id: true, branchId: true, businessDate: true, status: true, openedByUserId: true } });
  const temporaryCashSessions = await prisma.cashSession.findMany({
    where: { openingNote: { in: temporaryCashOpeningNotes } },
    select: { id: true, branchId: true, businessDate: true, status: true, openedByUserId: true, openingNote: true },
  });
  const demoMembershipPlans = await prisma.membershipPlan.findMany({
    where: { name: { in: demoMembershipPlanNames } },
    select: { id: true, name: true },
  });
  const demoPackages = await prisma.servicePackagePlan.findMany({
    where: { name: { in: demoPackageNames } },
    select: { id: true, name: true },
  });
  const demoProducts = await prisma.product.findMany({
    where: { name: { in: demoProductNames } },
    select: { id: true, name: true, sku: true },
  });
  const demoServices = await prisma.service.findMany({
    where: { name: { in: demoServiceNames } },
    select: { id: true, name: true, categoryId: true },
  });
  const inactiveDemoStaff = await prisma.staff.findMany({
    where: { isActive: false, displayName: { in: inactiveDemoStaffNames } },
    select: { id: true, displayName: true, userId: true },
  });
  const demoCategoryIds = Array.from(new Set(demoServices.map((service) => service.categoryId)));
  const preview = {
    placeholderUsers: placeholderUsers.map((user) => user.email),
    customers: demoCustomers,
    appointments: demoAppointments,
    invoices: demoInvoices,
    expenses: demoExpenses,
    cashSessions: [...demoCashSessions, ...temporaryCashSessions],
    membershipPlans: demoMembershipPlans,
    packages: demoPackages,
    products: demoProducts,
    services: demoServices,
    inactiveDemoStaff,
  };
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", preview }, null, 2));
  if (!APPLY) return;
  if (process.env.CONFIRM_DEMO_SCRUB !== CONFIRMATION) throw new Error(`Set CONFIRM_DEMO_SCRUB=${CONFIRMATION} and pass --apply`);

  await prisma.$transaction(async (tx) => {
    const membershipIds = (await tx.membership.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } })).map((row) => row.id);
    const customerPackageIds = (await tx.customerServicePackage.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } })).map((row) => row.id);
    const conversationIds = (await tx.conversation.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } })).map((row) => row.id);
    const messageIds = (await tx.message.findMany({ where: { conversationId: { in: conversationIds } }, select: { id: true } })).map((row) => row.id);
    const demoProductIds = demoProducts.map((product) => product.id);
    const demoServiceIds = demoServices.map((service) => service.id);

    await tx.couponRedemption.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
    await tx.invoice.deleteMany({ where: { id: { in: invoiceIds } } });
    await tx.appointmentEvent.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    await tx.appointmentItem.deleteMany({ where: { appointmentId: { in: appointmentIds } } });
    await tx.appointment.deleteMany({ where: { id: { in: appointmentIds } } });
    await tx.attachment.deleteMany({ where: { messageId: { in: messageIds } } });
    await tx.message.deleteMany({ where: { conversationId: { in: conversationIds } } });
    await tx.conversation.deleteMany({ where: { id: { in: conversationIds } } });
    await tx.campaignRecipient.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.waitlist.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.couponRedemption.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.loyaltyLedger.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.walletLedger.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.servicePackageLedger.deleteMany({ where: { customerServicePackageId: { in: customerPackageIds } } });
    await tx.customerServicePackage.deleteMany({ where: { id: { in: customerPackageIds } } });
    await tx.membershipLedger.deleteMany({ where: { membershipId: { in: membershipIds } } });
    await tx.membership.deleteMany({ where: { id: { in: membershipIds } } });
    await tx.customerHistoryEntry.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.customerCompanion.deleteMany({ where: { customerId: { in: customerIds } } });
    await tx.expense.deleteMany({ where: { id: { in: demoExpenses.map((expense) => expense.id) } } });
    await tx.cashSession.deleteMany({ where: { id: { in: [...demoCashSessions, ...temporaryCashSessions].map((session) => session.id) } } });
    await tx.customer.deleteMany({ where: { id: { in: customerIds } } });

    await tx.membershipPlan.deleteMany({ where: { id: { in: demoMembershipPlans.map((plan) => plan.id) } } });
    await tx.servicePackagePlan.deleteMany({ where: { id: { in: demoPackages.map((plan) => plan.id) } } });
    await tx.inventoryMovement.deleteMany({ where: { productId: { in: demoProductIds } } });
    await tx.purchaseItem.deleteMany({ where: { productId: { in: demoProductIds } } });
    await tx.product.deleteMany({ where: { id: { in: demoProductIds } } });
    await tx.serviceStaff.deleteMany({ where: { serviceId: { in: demoServiceIds } } });
    await tx.staffSkill.deleteMany({ where: { serviceId: { in: demoServiceIds } } });
    await tx.servicePackageLedger.deleteMany({ where: { serviceId: { in: demoServiceIds } } });
    await tx.servicePackageItem.deleteMany({ where: { serviceId: { in: demoServiceIds } } });
    await tx.service.deleteMany({ where: { id: { in: demoServiceIds } } });
    await tx.serviceCategory.deleteMany({
      where: { id: { in: demoCategoryIds }, services: { none: {} }, children: { none: {} } },
    });
    const inactiveDemoStaffIds = inactiveDemoStaff.map((staff) => staff.id);
    if (inactiveDemoStaffIds.length > 0) {
      // Payslip/PayrollRun are legacy tables retained in deployed databases but
      // no longer represented in the current Prisma schema.
      await tx.$executeRaw(Prisma.sql`DELETE FROM "Payslip" WHERE "staffId" IN (${Prisma.join(inactiveDemoStaffIds)})`);
      await tx.$executeRaw(Prisma.sql`DELETE FROM "PayrollRun" WHERE NOT EXISTS (SELECT 1 FROM "Payslip" WHERE "Payslip"."payrollRunId" = "PayrollRun"."id")`);
    }
    await tx.staff.deleteMany({ where: { id: { in: inactiveDemoStaffIds } } });

    // Placeholder seed users are not real accounts. Keep audit records intact,
    // but remove their obsolete identity links before deleting the accounts.
    await tx.auditLog.updateMany({ where: { actorUserId: { in: placeholderUserIds } }, data: { actorUserId: null } });
    await tx.staffInvite.updateMany({ where: { invitedByUserId: { in: placeholderUserIds } }, data: { invitedByUserId: null } });
    await tx.customer.updateMany({ where: { userId: { in: placeholderUserIds } }, data: { userId: null } });
    await tx.staff.updateMany({ where: { userId: { in: placeholderUserIds } }, data: { userId: null } });
    await tx.user.deleteMany({ where: { id: { in: placeholderUserIds } } });
  });
  console.log("Known demo records scrubbed. This operation was explicitly confirmed.");
}

main().finally(() => prisma.$disconnect());
