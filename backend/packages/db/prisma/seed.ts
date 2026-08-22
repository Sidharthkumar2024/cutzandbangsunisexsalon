import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase() || "owner@cutzbangs.local";
  const ownerPassword = process.env.SEED_OWNER_PASSWORD || "changeme123";
  if (process.env.NODE_ENV === "production" && (!process.env.SEED_OWNER_EMAIL || !process.env.SEED_OWNER_PASSWORD)) {
    throw new Error("SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD are required for a production seed");
  }
  if ((process.env.NODE_ENV === "production" || process.env.SEED_OWNER_PASSWORD) && ownerPassword.length < 12) {
    throw new Error("SEED_OWNER_PASSWORD must be at least 12 characters");
  }

  const branch = await prisma.branch.upsert({
    where: { id: "main" },
    create: { id: "main", name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059", latitude: 28.6166967, longitude: 77.0283703 },
    update: { name: "Cutz & Bangs — Sector 15 Dwarka", address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059", latitude: 28.6166967, longitude: 77.0283703 },
  });

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: {
      email: ownerEmail,
      role: "OWNER",
      branchId: branch.id,
      passwordHash: await argon2.hash(ownerPassword, { type: argon2.argon2id }),
    },
    update: {},
  });

  const cat =
    (await prisma.serviceCategory.findFirst({ where: { name: "Hair — Unisex" } })) ??
    (await prisma.serviceCategory.create({ data: { name: "Hair — Unisex", gender: "Unisex" } }));

  const haircut =
    (await prisma.service.findFirst({ where: { categoryId: cat.id, name: "Haircut", deletedAt: null } })) ??
    (await prisma.service.create({
      data: {
        categoryId: cat.id,
        name: "Haircut",
        durationMin: 30,
        bufferMin: 5,
        priceMinor: 40000, // ₹400
        taxRateBps: 1800, // 18% GST
      },
    }));

  const staffUser = await prisma.user.upsert({
    where: { email: "asha@cutzbangs.local" },
    create: { role: "STAFF", branchId: branch.id, email: "asha@cutzbangs.local" },
    update: { role: "STAFF", branchId: branch.id, isActive: true },
  });
  let staff = await prisma.staff.findUnique({ where: { userId: staffUser.id } });
  if (!staff) {
    staff = await prisma.staff.create({
      data: {
        userId: staffUser.id,
        branchId: branch.id,
        displayName: "Asha",
        commissionRate: 1000, // 10%
        shifts: {
          create: [1, 2, 3, 4, 5, 6].map((weekday) => ({
            weekday,
            startMin: 10 * 60, // 10:00
            endMin: 20 * 60, // 20:00
            breakStartMin: 14 * 60,
            breakEndMin: 14 * 60 + 30,
          })),
        },
      },
    });
  }
  await prisma.staffSkill.upsert({
    where: { staffId_serviceId: { staffId: staff.id, serviceId: haircut.id } },
    create: { staffId: staff.id, serviceId: haircut.id },
    update: {},
  });
  await prisma.serviceStaff.upsert({
    where: { serviceId_staffId: { serviceId: haircut.id, staffId: staff.id } },
    create: { serviceId: haircut.id, staffId: staff.id },
    update: {},
  });

  const plan = await prisma.membershipPlan.findFirst({ where: { name: "Pay 3000 get 5000" } });
  if (!plan) {
    await prisma.membershipPlan.create({
      data: { name: "Pay 3000 get 5000", payMinor: 300000, creditMinor: 500000, validityDays: null, memberDiscountBps: 0 },
    });
  }

  console.log({ branch: branch.id, owner: owner.email, staff: staff.displayName, service: haircut.name });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
