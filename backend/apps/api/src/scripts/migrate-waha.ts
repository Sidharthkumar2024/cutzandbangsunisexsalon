import { prisma } from "@cutz/db";

// Run only after the operator backs up .env and starts the private WAHA service.
if (!process.env.WAHA_API_KEY || process.env.WA_UNOFFICIAL_URL !== "http://waha:3000") {
  throw new Error("waha_deployment_env_required");
}
const rows = await prisma.setting.findMany({ where: { key: { endsWith: ":providers" } } });
for (const row of rows) {
  const value = row.value as Record<string, any>;
  if (!value.whatsappUnofficial) continue;
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({
      where: { key: `${row.key}:before-waha` },
      create: { key: `${row.key}:before-waha`, value: row.value! },
      update: {},
    });
    await tx.setting.update({ where: { key: row.key }, data: { value: {
      ...value,
      whatsappUnofficial: {
        ...value.whatsappUnofficial,
        enabled: true,
        baseUrl: process.env.WA_UNOFFICIAL_URL,
        session: process.env.WAHA_SESSION || "cutz-bangs-main",
      },
    } } });
  });
}
console.log(`WAHA provider settings migrated: ${rows.length}; previous settings preserved.`);
await prisma.$disconnect();
