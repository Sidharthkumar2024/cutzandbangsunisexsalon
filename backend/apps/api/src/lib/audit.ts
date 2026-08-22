import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";

/** Write an immutable audit trail entry. Use for money/permissioned actions. */
export async function audit(
  action: string,
  entityType: string,
  entityId: string,
  opts: { actorUserId?: string; before?: unknown; after?: unknown; ip?: string } = {},
  tx?: Prisma.TransactionClient,
) {
  const client = tx ?? prisma;
  await client.auditLog.create({
    data: {
      action,
      entityType,
      entityId,
      actorUserId: opts.actorUserId,
      before: opts.before as Prisma.InputJsonValue,
      after: opts.after as Prisma.InputJsonValue,
      ip: opts.ip,
    },
  });
}
