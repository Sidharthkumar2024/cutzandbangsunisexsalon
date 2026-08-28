import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  if (process.env.CONFIRM_CLEAR_CUSTOMER_DATA !== "yes") {
    console.error(
      "Refusing to clear data. Re-run with CONFIRM_CLEAR_CUSTOMER_DATA=yes.",
    );
    process.exitCode = 1;
    return;
  }

  const before = await prisma.$transaction([
    prisma.customer.count(),
    prisma.invoice.count(),
    prisma.appointment.count(),
    prisma.membership.count(),
    prisma.customerServicePackage.count(),
    prisma.conversation.count(),
    prisma.campaignRecipient.count(),
    prisma.waitlist.count({ where: { customerId: { not: null } } }),
  ]);

  await prisma.$transaction(
    async (tx) => {
      // Messaging and marketing records tied to customers.
      await tx.campaignRecipient.deleteMany({});
      await tx.conversation.deleteMany({ where: { customerId: { not: null } } });

      // Customer-specific appointment history.
      await tx.appointmentEvent.deleteMany({
        where: { appointment: { customerId: { not: null } } },
      });
      await tx.appointmentItem.deleteMany({
        where: { appointment: { customerId: { not: null } } },
      });
      await tx.appointment.deleteMany({ where: { customerId: { not: null } } });
      await tx.waitlist.deleteMany({ where: { customerId: { not: null } } });

      // Invoice and payment history. Refund rows use restrict relations, so
      // remove refund items before invoice items/refunds.
      await tx.invoiceRefundItem.deleteMany({});
      await tx.invoiceRefund.deleteMany({});
      await tx.payment.deleteMany({});
      await tx.couponRedemption.deleteMany({});
      await tx.loyaltyLedger.deleteMany({});
      await tx.walletLedger.deleteMany({});
      await tx.membershipLedger.deleteMany({});
      await tx.servicePackageLedger.deleteMany({});
      await tx.customerServicePackage.deleteMany({});
      await tx.membership.deleteMany({});
      await tx.invoiceItem.deleteMany({});
      await tx.invoice.deleteMany({});

      // Customer profile/history rows.
      await tx.customerHistoryEntry.deleteMany({});
      await tx.customerCompanion.deleteMany({});
      await tx.customer.deleteMany({});
    },
    { timeout: 60_000 },
  );

  const after = await prisma.$transaction([
    prisma.customer.count(),
    prisma.invoice.count(),
    prisma.appointment.count({ where: { customerId: { not: null } } }),
    prisma.membership.count(),
    prisma.customerServicePackage.count(),
    prisma.conversation.count({ where: { customerId: { not: null } } }),
    prisma.campaignRecipient.count(),
    prisma.waitlist.count({ where: { customerId: { not: null } } }),
  ]);

  console.log(
    JSON.stringify(
      {
        cleared: {
          customers: before[0] - after[0],
          invoices: before[1] - after[1],
          appointments: before[2] - after[2],
          memberships: before[3] - after[3],
          servicePackages: before[4] - after[4],
          conversations: before[5] - after[5],
          campaignRecipients: before[6] - after[6],
          waitlistEntries: before[7] - after[7],
        },
        remaining: {
          customers: after[0],
          invoices: after[1],
          customerAppointments: after[2],
          memberships: after[3],
          servicePackages: after[4],
          customerConversations: after[5],
          campaignRecipients: after[6],
          customerWaitlistEntries: after[7],
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
