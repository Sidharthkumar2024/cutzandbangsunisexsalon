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
    user?: { id: string; role: RoleName; branchId: string | null };
  }
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export default fp(async function authPlugin(app: FastifyInstance) {
  app.decorateRequest("user", undefined);

  // Resolve the session on every request (if a bearer token is present).
  app.addHook("onRequest", async (req: FastifyRequest) => {
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
    };
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
