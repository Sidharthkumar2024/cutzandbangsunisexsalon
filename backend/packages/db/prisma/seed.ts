import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const branch = await prisma.branch.upsert({
    where: { id: "main" },
    create: { id: "main", name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059", latitude: 28.6166967, longitude: 77.0283703 },
    update: { name: "Cutz & Bangs — Sector 15 Dwarka", timezone: "Asia/Kolkata", currency: "INR", address: "First Floor, Plot No. 118, Main Kakrola Road, Patel Garden, Sector 15 Dwarka, New Delhi, Delhi 110059", latitude: 28.6166967, longitude: 77.0283703 },
  });
  const ownerEmail = process.env.SEED_OWNER_EMAIL?.trim().toLowerCase();
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  if (Boolean(ownerEmail) !== Boolean(ownerPassword)) throw new Error("SEED_OWNER_EMAIL and SEED_OWNER_PASSWORD must be supplied together");
  if (ownerEmail && ownerPassword) {
    if (ownerEmail.endsWith("@cutzbangs.local")) throw new Error("SEED_OWNER_EMAIL must be a real non-@cutzbangs.local address");
    if (ownerPassword.length < 12) throw new Error("SEED_OWNER_PASSWORD must be at least 12 characters");
    const passwordHash = await argon2.hash(ownerPassword, { type: argon2.argon2id });
    await prisma.user.upsert({
      where: { email: ownerEmail },
      create: { email: ownerEmail, role: "OWNER", branchId: branch.id, passwordHash },
      update: { role: "OWNER", branchId: branch.id, isActive: true, passwordHash },
    });
  }
  console.log({ branch: branch.id, ownerBootstrapped: Boolean(ownerEmail), demoRecordsCreated: 0 });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
