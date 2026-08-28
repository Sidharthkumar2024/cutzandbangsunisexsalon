import { FastifyInstance } from "fastify";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import QRCode from "qrcode";
import { prisma } from "@cutz/db";
import { decryptSecret, encryptSecret, passwordResetEmail } from "@cutz/providers";
import { enqueueEmail } from "@cutz/queue";
import { hashPassword, verifyPassword } from "../../lib/password.js";
import { audit } from "../../lib/audit.js";
import { authorize, hashToken } from "../../plugins/auth.js";
import { getLoyaltyRules, postLoyaltyEntry } from "../loyalty/ledger.js";
import {
  buildOtpAuthUri,
  findRecoveryCodeHash,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  verifyTotp,
} from "./two-factor.js";

const SESSION_TTL_MS = Number(process.env.SESSION_TTL_HOURS ?? 168) * 3600_000;

function issueToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

function twoFactorCredential(input: { code?: string; recoveryCode?: string }) {
  return input.code?.trim() || input.recoveryCode?.trim();
}

async function resolveActiveTenantId(user: { activeTenantId: string | null; branchId: string | null }) {
  if (user.activeTenantId) return user.activeTenantId;
  if (!user.branchId) return "default";
  const branch = await prisma.branch.findFirst({
    where: { id: user.branchId, deletedAt: null },
    select: { tenantId: true },
  });
  return branch?.tenantId ?? "default";
}

export default async function authRoutes(app: FastifyInstance) {
  app.post("/auth/login", { config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { email: rawEmail, password, code, recoveryCode } = z
      .object({
        email: z.string().email(),
        password: z.string().min(1),
        code: z.string().regex(/^\d{6}$/u).optional(),
        recoveryCode: z.string().min(8).max(32).optional(),
      })
      .parse(req.body);
    const email = rawEmail.trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user?.passwordHash || !user.isActive || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    if (user.twoFaEnabledAt) {
      const supplied = twoFactorCredential({ code, recoveryCode });
      if (!supplied) {
        return reply.code(202).send({ twoFactorRequired: true });
      }
      const secret = decryptSecret(user.twoFaSecret);
      const recoveryHash = recoveryCode
        ? findRecoveryCodeHash(recoveryCode, user.twoFaRecoveryCodes)
        : undefined;
      const valid = Boolean(
        (code && secret && verifyTotp(secret, code)) || recoveryHash,
      );
      if (!valid) return reply.code(401).send({ error: "invalid_two_factor_code" });
      if (recoveryHash) {
        await prisma.user.update({
          where: { id: user.id },
          data: {
            twoFaRecoveryCodes: {
              set: user.twoFaRecoveryCodes.filter((item) => item !== recoveryHash),
            },
          },
        });
      }
    }

    const existingToken = req.headers.authorization?.startsWith("Bearer ")
      ? req.headers.authorization.slice(7)
      : undefined;
    if (existingToken) {
      await prisma.session.deleteMany({ where: { tokenHash: hashToken(existingToken) } });
    }
    const activeTenantId = await resolveActiveTenantId(user);
    const { token, tokenHash } = issueToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        activeTenantId,
        tokenHash,
        expiresAt: new Date(Date.now() + SESSION_TTL_MS),
        ip: req.ip,
        userAgent: req.headers["user-agent"],
      },
    });
    return {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        activeTenantId,
        branchId: user.branchId,
        permissionKeys: user.permissionKeys,
        twoFactorEnabled: Boolean(user.twoFaEnabledAt),
      },
    };
  });

  // Customer self-registration (optional login for customers).
  app.post("/auth/register", { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { name, email: rawEmail, phone, password, branchId } = z
      .object({
        name: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        password: z.string().min(8),
        branchId: z.string(),
      })
      .parse(req.body);
    const email = rawEmail.trim().toLowerCase();

    const exists = await prisma.user.findUnique({ where: { email } });
    if (exists) return reply.code(409).send({ error: "email_taken" });
    const branch = await prisma.branch.findFirst({ where: { id: branchId, deletedAt: null }, select: { id: true, tenantId: true } });
    if (!branch) return reply.code(400).send({ error: "branch_not_found" });

    const passwordHash = await hashPassword(password);
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          phone,
          role: "CUSTOMER",
          activeTenantId: branch.tenantId,
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
      data: { userId: user.id, activeTenantId: branch.tenantId, tokenHash, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
    });
    return reply.code(201).send({ token, user: { id: user.id, email, role: user.role, activeTenantId: branch.tenantId, branchId } });
  });

  app.post("/auth/password/forgot", { config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const startedAt = Date.now();
    const { email: rawEmail } = z.object({ email: z.string().email() }).parse(req.body);
    const email = rawEmail.trim().toLowerCase();
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, branchId: true, isActive: true, staff: { select: { displayName: true } } },
    });
    const publicAppUrl = process.env.PUBLIC_APP_URL?.replace(/\/$/u, "");
    if (user?.email && user.isActive && publicAppUrl) {
      const token = randomBytes(32).toString("base64url");
      const tokenHash = hashToken(token);
      const expiresAt = new Date(Date.now() + 30 * 60_000);
      await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
          where: { userId: user.id, usedAt: null },
          data: { usedAt: new Date() },
        }),
        prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash, expiresAt },
        }),
      ]);
      const resetUrl = `${publicAppUrl}/reset-password?token=${encodeURIComponent(token)}`;
      await enqueueEmail({
        branchId: user.branchId ?? "main",
        to: user.email,
        subject: "Reset your Cutz & Bangs password",
        html: passwordResetEmail(user.staff?.displayName, resetUrl),
        dedupeKey: `password-reset:${tokenHash}`,
      }).catch((error) => app.log.error({ err: error }, "password reset email could not be queued"));
    }
    // Always return the same result to prevent account enumeration.
    const remainingDelay = 350 - (Date.now() - startedAt);
    if (remainingDelay > 0) await new Promise((resolve) => setTimeout(resolve, remainingDelay));
    return reply.code(202).send({ accepted: true });
  });

  app.post("/auth/password/reset", { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { token, password } = z
      .object({ token: z.string().min(32).max(200), password: z.string().min(10).max(128) })
      .parse(req.body);
    const tokenHash = hashToken(token);
    const reset = await prisma.passwordResetToken.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true, usedAt: true },
    });
    if (!reset || reset.usedAt || reset.expiresAt <= new Date()) {
      return reply.code(400).send({ error: "invalid_or_expired_reset_token" });
    }
    const passwordHash = await hashPassword(password);
    try {
      await prisma.$transaction(async (tx) => {
        const claimed = await tx.passwordResetToken.updateMany({
          where: { id: reset.id, usedAt: null, expiresAt: { gt: new Date() } },
          data: { usedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("reset_token_already_used");
        await tx.user.update({ where: { id: reset.userId }, data: { passwordHash } });
        await tx.session.deleteMany({ where: { userId: reset.userId } });
        await tx.passwordResetToken.updateMany({
          where: { userId: reset.userId, usedAt: null },
          data: { usedAt: new Date() },
        });
        await audit("auth.password_reset", "User", reset.userId, {
          actorUserId: reset.userId,
          after: { sessionsRevoked: true },
          ip: req.ip,
        }, tx);
      });
    } catch {
      return reply.code(400).send({ error: "invalid_or_expired_reset_token" });
    }
    return reply.code(204).send();
  });

  app.get("/auth/staff-invite/preview", { config: { rateLimit: { max: 20, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { token } = z.object({ token: z.string().min(32).max(200) }).parse(req.query);
    const invite = await prisma.staffInvite.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { staff: { select: { displayName: true, designation: true } } },
    });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) return reply.code(400).send({ error: "invalid_or_expired_invitation" });
    return { email: invite.email, role: invite.role, permissionKeys: invite.permissionKeys, staff: invite.staff, expiresAt: invite.expiresAt };
  });

  app.post("/auth/staff-invite/accept", { config: { rateLimit: { max: 8, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { token, password } = z.object({ token: z.string().min(32).max(200), password: z.string().min(10).max(128) }).parse(req.body);
    const tokenHash = hashToken(token);
    const invite = await prisma.staffInvite.findUnique({ where: { tokenHash }, include: { staff: { include: { branch: { select: { tenantId: true } } } } } });
    if (!invite || invite.acceptedAt || invite.expiresAt <= new Date()) return reply.code(400).send({ error: "invalid_or_expired_invitation" });
    const passwordHash = await hashPassword(password);
    try {
      const user = await prisma.$transaction(async (tx) => {
        const claimed = await tx.staffInvite.updateMany({
          where: { id: invite.id, acceptedAt: null, expiresAt: { gt: new Date() } },
          data: { acceptedAt: new Date() },
        });
        if (claimed.count !== 1) throw new Error("invite_claimed");
        const existing = invite.staff.userId
          ? await tx.user.findUnique({ where: { id: invite.staff.userId } })
          : await tx.user.findUnique({ where: { email: invite.email } });
        const account = existing
          ? await tx.user.update({ where: { id: existing.id }, data: { email: invite.email, passwordHash, role: invite.role, permissionKeys: { set: invite.permissionKeys }, activeTenantId: invite.staff.branch.tenantId, branchId: invite.staff.branchId, isActive: true } })
          : await tx.user.create({ data: { email: invite.email, passwordHash, role: invite.role, permissionKeys: invite.permissionKeys, activeTenantId: invite.staff.branch.tenantId, branchId: invite.staff.branchId, isActive: true } });
        await tx.tenantMembership.upsert({
          where: { tenantId_userId: { tenantId: invite.staff.branch.tenantId, userId: account.id } },
          create: { tenantId: invite.staff.branch.tenantId, userId: account.id, role: invite.role, branchId: invite.staff.branchId, permissionKeys: invite.permissionKeys, isActive: true },
          update: { role: invite.role, branchId: invite.staff.branchId, permissionKeys: { set: invite.permissionKeys }, isActive: true },
        });
        await tx.staff.update({ where: { id: invite.staffId }, data: { userId: account.id } });
        await tx.session.deleteMany({ where: { userId: account.id } });
        await tx.staffInvite.updateMany({ where: { staffId: invite.staffId, id: { not: invite.id }, acceptedAt: null }, data: { acceptedAt: new Date() } });
        await audit("staff.invite.accept", "Staff", invite.staffId, { actorUserId: account.id, after: { role: invite.role, permissionKeys: invite.permissionKeys }, ip: req.ip }, tx);
        return account;
      });
      return reply.code(201).send({ accepted: true, email: user.email, role: user.role });
    } catch {
      return reply.code(400).send({ error: "invalid_or_expired_invitation" });
    }
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
      select: { id: true, email: true, phone: true, role: true, activeTenantId: true, branchId: true, permissionKeys: true, twoFaEnabledAt: true },
    });
    if (!user) return reply.code(401).send({ error: "unauthenticated" });
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      activeTenantId: req.user.activeTenantId ?? user.activeTenantId,
      branchId: user.branchId,
      permissionKeys: user.permissionKeys,
      twoFactorEnabled: Boolean(user.twoFaEnabledAt),
    };
  });

  app.get("/auth/2fa/status", { preHandler: authorize() }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { twoFaSecret: true, twoFaEnabledAt: true, twoFaRecoveryCodes: true },
    });
    return {
      enabled: Boolean(user.twoFaEnabledAt),
      enabledAt: user.twoFaEnabledAt,
      setupPending: Boolean(user.twoFaSecret && !user.twoFaEnabledAt),
      recoveryCodesRemaining: user.twoFaRecoveryCodes.length,
    };
  });

  app.post("/auth/2fa/setup", { preHandler: authorize(), config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, email: true, twoFaEnabledAt: true },
    });
    if (user.twoFaEnabledAt) return reply.code(409).send({ error: "two_factor_already_enabled" });

    const secret = generateTotpSecret();
    const otpAuthUri = buildOtpAuthUri({
      secret,
      account: user.email ?? user.id,
      issuer: process.env.TOTP_ISSUER,
    });
    const qrDataUrl = await QRCode.toDataURL(otpAuthUri, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 280,
    });
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFaSecret: encryptSecret(secret),
        twoFaEnabledAt: null,
        twoFaRecoveryCodes: { set: [] },
      },
    });
    await audit("auth.2fa_setup", "User", user.id, {
      actorUserId: user.id,
      after: { setupPending: true },
      ip: req.ip,
    });
    return { qrDataUrl, manualKey: secret, otpAuthUri };
  });

  app.post("/auth/2fa/enable", { preHandler: authorize(), config: { rateLimit: { max: 10, timeWindow: "15 minutes" } } }, async (req, reply) => {
    const { code } = z.object({ code: z.string().regex(/^\d{6}$/u) }).parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, twoFaSecret: true, twoFaEnabledAt: true },
    });
    if (user.twoFaEnabledAt) return reply.code(409).send({ error: "two_factor_already_enabled" });
    const secret = decryptSecret(user.twoFaSecret);
    if (!secret) return reply.code(409).send({ error: "two_factor_setup_required" });
    if (!verifyTotp(secret, code)) return reply.code(400).send({ error: "invalid_two_factor_code" });

    const recoveryCodes = generateRecoveryCodes();
    const enabledAt = new Date();
    await prisma.user.update({
      where: { id: user.id },
      data: {
        twoFaEnabledAt: enabledAt,
        twoFaRecoveryCodes: { set: recoveryCodes.map(hashRecoveryCode) },
      },
    });
    await audit("auth.2fa_enable", "User", user.id, {
      actorUserId: user.id,
      after: { enabledAt: enabledAt.toISOString(), recoveryCodes: recoveryCodes.length },
      ip: req.ip,
    });
    return { enabled: true, enabledAt, recoveryCodes };
  });

  app.post("/auth/2fa/recovery-codes", { preHandler: authorize(), config: { rateLimit: { max: 3, timeWindow: "1 hour" } } }, async (req, reply) => {
    const { password, code } = z
      .object({ password: z.string().min(1), code: z.string().regex(/^\d{6}$/u) })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, passwordHash: true, twoFaSecret: true, twoFaEnabledAt: true },
    });
    const secret = decryptSecret(user.twoFaSecret);
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    if (!user.twoFaEnabledAt || !secret || !verifyTotp(secret, code)) {
      return reply.code(400).send({ error: "invalid_two_factor_code" });
    }
    const recoveryCodes = generateRecoveryCodes();
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaRecoveryCodes: { set: recoveryCodes.map(hashRecoveryCode) } },
    });
    await audit("auth.2fa_recovery_rotate", "User", user.id, {
      actorUserId: user.id,
      after: { recoveryCodes: recoveryCodes.length },
      ip: req.ip,
    });
    return { recoveryCodes };
  });

  app.post("/auth/2fa/disable", { preHandler: authorize(), config: { rateLimit: { max: 5, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = z
      .object({
        password: z.string().min(1),
        code: z.string().regex(/^\d{6}$/u).optional(),
        recoveryCode: z.string().min(8).max(32).optional(),
      })
      .refine((value) => Boolean(value.code || value.recoveryCode), { message: "two_factor_code_required" })
      .parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, passwordHash: true, twoFaSecret: true, twoFaEnabledAt: true, twoFaRecoveryCodes: true },
    });
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, body.password))) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const secret = decryptSecret(user.twoFaSecret);
    const recoveryHash = body.recoveryCode
      ? findRecoveryCodeHash(body.recoveryCode, user.twoFaRecoveryCodes)
      : undefined;
    if (!user.twoFaEnabledAt || !((body.code && secret && verifyTotp(secret, body.code)) || recoveryHash)) {
      return reply.code(400).send({ error: "invalid_two_factor_code" });
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFaSecret: null, twoFaEnabledAt: null, twoFaRecoveryCodes: { set: [] } },
    });
    const currentToken = req.headers.authorization?.startsWith("Bearer ")
      ? hashToken(req.headers.authorization.slice(7))
      : undefined;
    await prisma.session.deleteMany({
      where: { userId: user.id, ...(currentToken ? { tokenHash: { not: currentToken } } : {}) },
    });
    await audit("auth.2fa_disable", "User", user.id, {
      actorUserId: user.id,
      after: { enabled: false },
      ip: req.ip,
    });
    return { enabled: false };
  });
}
