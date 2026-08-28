import { prisma } from "@cutz/db";

export type TenantScopedUser = {
  id: string;
  role: string;
  activeTenantId: string | null;
  branchId: string | null;
};

export function canChooseTenant(role: string) {
  return role === "SUPERADMIN";
}

export async function resolveTenantScope(user: TenantScopedUser, requested?: string | null) {
  const requestedTenantId = requested?.trim() || undefined;
  if (canChooseTenant(user.role)) return { ok: true as const, tenantId: requestedTenantId ?? user.activeTenantId ?? "default" };
  const tenantId = requestedTenantId ?? user.activeTenantId;
  if (!tenantId) return { ok: false as const, statusCode: 400 as const, error: "tenant_required" as const };
  const membership = await prisma.tenantMembership.findFirst({
    where: { tenantId, userId: user.id, isActive: true, tenant: { deletedAt: null } },
    select: { tenantId: true },
  });
  if (!membership) return { ok: false as const, statusCode: 403 as const, error: "forbidden" as const };
  return { ok: true as const, tenantId };
}

export async function canAccessTenant(user: TenantScopedUser, tenantId: string) {
  if (canChooseTenant(user.role)) return true;
  const scope = await resolveTenantScope(user, tenantId);
  return scope.ok;
}
