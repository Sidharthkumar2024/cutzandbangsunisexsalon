// RBAC + session auth as a Fastify plugin.
// - Passwords hashed with argon2 (see lib/password.ts).
// - Sessions are opaque tokens; only their SHA-256 hash is stored.
// - `authorize(...roles)` is a route preHandler guard.

import { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createHash } from "node:crypto";
import { RoleName } from "@prisma/client";
import { prisma } from "@cutz/db";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string; role: RoleName; branchId: string | null; permissionKeys: string[] };
  }
}

export const WORKSPACE_PERMISSIONS = [
  "dashboard", "calendar", "pos", "customers", "memberships", "inbox", "services", "inventory",
  "cash", "website", "coupons", "campaigns", "reports", "staff", "payroll", "settings", "audit",
] as const;

function permissionForPath(path: string): string | undefined {
  if (/^\/(auth|health|integrations\/bookings|webhooks)\b/u.test(path)) return undefined;
  if (/^\/(pos|invoices|discounts)\b/u.test(path)) return "pos";
  if (/^\/(cash-sessions|expenses)\b/u.test(path)) return "cash";
  if (/^\/(customers|loyalty)\b/u.test(path)) return "customers";
  if (/^\/(memberships|membership-plans|service-packages|customer-service-packages)\b/u.test(path)) return "memberships";
  if (/^\/(appointments|availability|bookings|waitlist)\b/u.test(path)) return "calendar";
  if (/^\/(conversations|messages|inbox)\b/u.test(path)) return "inbox";
  if (/^\/(services|service-categories)\b/u.test(path)) return "services";
  if (/^\/(products|inventory|vendors|purchase-orders)\b/u.test(path)) return "inventory";
  if (/^\/(coupons)\b/u.test(path)) return "coupons";
  if (/^\/(campaigns)\b/u.test(path)) return "campaigns";
  if (/^\/reports\/(today|dashboard)\b/u.test(path) || /^\/dashboard\b/u.test(path)) return "dashboard";
  if (/^\/reports\b/u.test(path)) return "reports";
  if (/^\/(staff|attendance|leaves|biometric|team-accounts)\b/u.test(path)) return "staff";
  if (/^\/(payroll|commissions)\b/u.test(path)) return "payroll";
  if (/^\/(content|website)\b/u.test(path)) return "website";
  if (/^\/(audit)\b/u.test(path)) return "audit";
  if (/^\/(settings|integrations|system|provider)\b/u.test(path)) return "settings";
  return undefined;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("user", undefined);

  // Resolve the session on every request (if a bearer token is present).
  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) return;
    const token = header.slice(7);
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true },
    });
    if (!session || session.expiresAt < new Date() || !session.user.isActive) return;
    req.user = {
      id: session.user.id,
      role: session.user.role,
      branchId: session.user.branchId,
      permissionKeys: session.user.permissionKeys,
    };
    const path = req.url.split("?", 1)[0]?.replace(/^\/api\/v1/u, "") || "/";
    const required = permissionForPath(path);
    if (required && session.user.role !== "OWNER" && session.user.permissionKeys.length > 0 && !session.user.permissionKeys.includes(required)) {
      return reply.code(403).send({ error: "permission_required", permission: required });
    }
  });
});

/** Route guard: require an authenticated user with one of the allowed roles. */
export function authorize(...roles: RoleName[]) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    if (roles.length && !roles.includes(req.user.role)) {
      return reply.code(403).send({ error: "forbidden", need: roles });
    }
  };
}
