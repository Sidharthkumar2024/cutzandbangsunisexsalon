// Catalog alignment seed: mirrors the exact services & staff (with the same
// slug IDs) that the Codex `salon` UI uses in app/book/page.tsx, so the UI's
// booking payload resolves directly against this backend with no ID mapping.
//
// Idempotent: fixed IDs + upserts, safe to re-run.

import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

const CATEGORIES = [
  { id: "cat-hair", name: "Hair", gender: "Unisex" },
  { id: "cat-colour", name: "Colour", gender: "Unisex" },
  { id: "cat-skin", name: "Skin", gender: "Unisex" },
  { id: "cat-grooming", name: "Grooming", gender: "Unisex" },
  { id: "cat-nails", name: "Nails", gender: "Unisex" },
];

// id, categoryId, name, durationMin, priceRupees, eligible staff slugs
const SERVICES = [
  { id: "cut-style", categoryId: "cat-hair", name: "Signature cut & style", durationMin: 60, price: 799, staff: ["riya", "arjun"] },
  { id: "global-colour", categoryId: "cat-colour", name: "Global colour ritual", durationMin: 120, price: 2499, staff: ["riya"] },
  { id: "hair-spa", categoryId: "cat-hair", name: "Restorative hair spa", durationMin: 75, price: 1299, staff: ["riya", "arjun"] },
  { id: "skin-reset", categoryId: "cat-skin", name: "Skin reset facial", durationMin: 75, price: 1499, staff: ["meher"] },
  { id: "beard-sculpt", categoryId: "cat-grooming", name: "Beard sculpt & care", durationMin: 35, price: 499, staff: ["arjun"] },
  { id: "manicure", categoryId: "cat-nails", name: "Essential manicure", durationMin: 45, price: 699, staff: ["meher"] },
];

const STAFF = [
  { id: "riya", name: "Riya Sen", email: "riya@cutzbangs.local" },
  { id: "arjun", name: "Arjun Khanna", email: "arjun@cutzbangs.local" },
  { id: "meher", name: "Meher Malik", email: "meher@cutzbangs.local" },
];

async function main() {
  await prisma.branch.upsert({
    where: { id: "main" },
    create: { id: "main", name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", latitude: 28.6166967, longitude: 77.0283703, address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059" },
    update: { name: "Cutz & Bangs — Sector 15 Dwarka", latitude: 28.6166967, longitude: 77.0283703, address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059" },
  });

  for (const c of CATEGORIES) {
    await prisma.serviceCategory.upsert({ where: { id: c.id }, create: c, update: { name: c.name } });
  }

  for (const s of SERVICES) {
    await prisma.service.upsert({
      where: { id: s.id },
      create: {
        id: s.id,
        categoryId: s.categoryId,
        name: s.name,
        durationMin: s.durationMin,
        bufferMin: 5,
        priceMinor: s.price * 100,
        taxRateBps: 1800,
      },
      update: { name: s.name, durationMin: s.durationMin, priceMinor: s.price * 100 },
    });
  }

  for (const st of STAFF) {
    const user = await prisma.user.upsert({
      where: { email: st.email },
      create: { email: st.email, role: "STAFF", branchId: "main", passwordHash: await argon2.hash("changeme123", { type: argon2.argon2id }) },
      update: { role: "STAFF", branchId: "main", isActive: true },
    });
    await prisma.staff.upsert({
      where: { id: st.id },
      create: { id: st.id, userId: user.id, branchId: "main", displayName: st.name, commissionRate: 1000 },
      update: { userId: user.id, displayName: st.name },
    });
    // Shifts every day 10:00–20:00 with a 14:00–14:30 break (idempotent reset).
    await prisma.shift.deleteMany({ where: { staffId: st.id } });
    await prisma.shift.createMany({
      data: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
        staffId: st.id, weekday, startMin: 10 * 60, endMin: 20 * 60, breakStartMin: 14 * 60, breakEndMin: 14 * 60 + 30,
      })),
    });
  }

  // Skill + eligibility mappings (idempotent).
  for (const s of SERVICES) {
    for (const staffId of s.staff) {
      await prisma.serviceStaff.upsert({
        where: { serviceId_staffId: { serviceId: s.id, staffId } },
        create: { serviceId: s.id, staffId },
        update: {},
      });
      await prisma.staffSkill.upsert({
        where: { staffId_serviceId: { staffId, serviceId: s.id } },
        create: { staffId, serviceId: s.id },
        update: {},
      });
    }
  }

  const MEMBERSHIPS = [
    { id: "membership-basic", name: "Basic", payMinor: 300_000, creditMinor: 500_000 },
    { id: "membership-premium", name: "Premium", payMinor: 1_000_000, creditMinor: 1_500_000 },
    { id: "membership-super-premium", name: "Super Premium", payMinor: 2_000_000, creditMinor: 3_200_000 },
  ];
  for (const plan of MEMBERSHIPS) {
    await prisma.membershipPlan.upsert({
      where: { id: plan.id },
      create: { ...plan, validityDays: 365, memberDiscountBps: 0 },
      update: { name: plan.name, payMinor: plan.payMinor, creditMinor: plan.creditMinor, validityDays: 365, isActive: true },
    });
  }

  await prisma.servicePackagePlan.upsert({
    where: { id: "package-hair-essentials" },
    create: {
      id: "package-hair-essentials",
      name: "Hair Essentials",
      priceMinor: 349_900,
      validityDays: 180,
      items: {
        create: [
          { serviceId: "cut-style", qty: 3 },
          { serviceId: "hair-spa", qty: 1 },
        ],
      },
    },
    update: { name: "Hair Essentials", priceMinor: 349_900, validityDays: 180, isActive: true },
  });

  await prisma.setting.upsert({
    where: { key: "branch:main:loyalty" },
    create: {
      key: "branch:main:loyalty",
      value: { enabled: true, welcomePoints: 50, earnPoints: 1, earnEveryMinor: 10_000, redeemMinorPerPoint: 100, minRedeemPoints: 50 },
    },
    update: {},
  });

  console.log(`Codex catalog seeded: ${CATEGORIES.length} categories, ${SERVICES.length} services, ${STAFF.length} staff, ${MEMBERSHIPS.length} memberships and 1 service package.`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
