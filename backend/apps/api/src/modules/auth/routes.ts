import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { prisma } from "@cutz/db";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { hashToken } from "../../plugins/auth.js";
import { getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 168) * 3600_000;

function issueToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { email, password } = z
      .object({ email: z.string().email(), password: z.string().min(1) })
      .parse(req.body);

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !user.isActive || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const { token, tokenHash } = issueToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });
    return { token, user: { id: user.id, email: user.email, role: user.role, branchId: user.branchId } };
  });

  // Customer self-registration (optional login for customers).
  app.post("/auth/register", { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { name, email, phone, password, branchId } = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        password: z.string().min(8),
        branchId: z.string(),
      })
      .parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return reply.code(409).send({ error: "email_taken" });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { id: true } });
    if (!branch) return reply.code(400).send({ error: "branch_not_found" });

    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          phone,
          role: "CUSTOMER",
          branchId,
          passwordHash,
          customer: { create: { name, email, phone, branchId, emailConsent: true } },
        },
        include: { customer: { select: { id: true } } },
      });
      const rules = await getLoyaltyRules(tx, branchId);
      if (created.customer && rules.enabled && rules.welcomePoints > 0) {
        await postLoyaltyEntry(tx, {
          customerId: created.customer.id,
          type: "WELCOME",
          deltaPoints: rules.welcomePoints,
          reason: "Welcome points",
          actorUserId: created.id,
        });
      }
      return created;
    });
    const { token, tokenHash } = issueToken();
    await prisma.session.create({
      data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    return reply.code(201).send({ token, user: { id: user.id, email, role: user.role } });
  });

  app.post("/auth/logout", async (req, reply) => {
    const header = req.headers.authorization;
    if (header?.startsWith("Bearer ")) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(header.slice(7)) } });
    }
    return reply.code(204).send();
  });

  app.get("/auth/me", async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: "unauthenticated" });
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, email: true, phone: true, role: true, branchId: true },
    });
    return user;
  });
}
