import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const plan = await prisma.plan.upsert({
    where: { slug: "starter" },
    create: {
      id: "starter",
      slug: "starter",
      name: "Starter",
      description: "Single-branch starter plan for early salon tenants.",
      maxBranches: 1,
      maxStaff: 8,
      features: ["pos", "customers", "staff", "reports", "email", "whatsapp"],
    },
    update: {
      name: "Starter",
      description: "Single-branch starter plan for early salon tenants.",
      maxBranches: 1,
      maxStaff: 8,
      features: ["pos", "customers", "staff", "reports", "email", "whatsapp"],
      isActive: true,
    },
  });
  const tenant = await prisma.tenant.upsert({
    where: { slug: "cutz-bangs" },
    create: {
      id: "default",
      slug: "cutz-bangs",
      name: "Cutz & Bangs",
      status: "ACTIVE",
      timezone: "Asia/Kolkata",
      currency: "INR",
      planId: plan.id,
    },
    update: {
      name: "Cutz & Bangs",
      status: "ACTIVE",
      timezone: "Asia/Kolkata",
      currency: "INR",
      planId: plan.id,
    },
  });
  const branch = await prisma.branch.upsert({
    where: { id: "main" },
    create: { id: "main", tenantId: tenant.id, name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059", latitude: 28.6166967, longitude: 77.0283703 },
    update: { tenantId: tenant.id, name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059", latitude: 28.6166967, longitude: 77.0283703 },
  });
  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (Boolean(ownerEmail) !== Boolean(ownerPassword)) throw new Error("SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD must be supplied together");
  if (ownerEmail && ownerPassword) {
    if (ownerEmail.endsWith("@cutzbangs.local")) throw new Error("SEED_OWNER_EMAIL must be a real non-@cutzbangs.local address");
    if (ownerPassword.length < 12) throw new Error("SEED_OWNER_PASSWORD must be at least 12 characters");
    const passwordHash = await argon2.hash(ownerPassword, { type: argon2.argon2id });
    const owner = await prisma.user.upsert({
      where: { email: ownerEmail },
      create: { email: ownerEmail, role: "OWNER", activeTenantId: tenant.id, branchId: branch.id, passwordHash },
      update: { role: "OWNER", activeTenantId: tenant.id, branchId: branch.id, isActive: true, passwordHash },
    });
    await prisma.tenant.update({ where: { id: tenant.id }, data: { ownerUserId: owner.id } });
    await prisma.tenantMembership.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: owner.id } },
      create: { tenantId: tenant.id, userId: owner.id, role: "OWNER", branchId: branch.id, isActive: true },
      update: { role: "OWNER", branchId: branch.id, isActive: true },
    });
  }
  console.log({ tenant: tenant.id, branch: branch.id, ownerBootstrapped: Boolean(ownerEmail), demoRecordsCreated: 0 });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
