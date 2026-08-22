import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { enqueueReminder } from "@cutz/queue";
import { authorize } from "../../plugins/auth.js";
import { resolveBooking, SlotUnavailableError, SlotRequest } from "../bookings/availability.js";
import { audit } from "../../lib/audit.js";

const STAFF = ["OWNER", "ADMIN", "MANAGER", "RECEPTION"] as const;

export default async function waitlistRoutes(app: FastifyInstance) {
  // Add to waitlist (public — a guest whose slot was full can join).
  app.post("/waitlist", { config: { rateLimit: { max: 12, timeWindow: "1 hour" } } }, async (req, reply) => {
    const body = z
      .object({
        branchId: z.string(),
        serviceId: z.string(),
        staffId: z.string().optional(),
        customerId: z.string().optional(),
        guest: z.object({ name: z.string(), phone: z.string(), email: z.string().email().optional() }).optional(),
        desiredDate: z.coerce.date(),
        note: z.string().optional(),
      })
      .parse(req.body);
    if (!body.customerId && !body.guest) return reply.code(400).send({ error: "customer_or_guest_required" });
    if (body.customerId) {
      if (!req.user) return reply.code(401).send({ error: "customer_waitlist_requires_session" });
      const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { userId: true, branchId: true } });
      if (!customer) return reply.code(404).send({ error: "customer_not_found" });
      if (customer.branchId !== body.branchId) return reply.code(400).send({ error: "customer_branch_mismatch" });
      if (req.user.role === "CUSTOMER" && customer.userId !== req.user.id) return reply.code(403).send({ error: "forbidden" });
      if (!["OWNER", "ADMIN", "SUPERADMIN", "CUSTOMER"].includes(req.user.role) && req.user.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });
    }
    if (body.staffId) {
      const staff = await prisma.staff.findFirst({ where: { id: body.staffId, branchId: body.branchId, isActive: true, deletedAt: null }, select: { id: true } });
      if (!staff) return reply.code(400).send({ error: "staff_branch_mismatch" });
    }

    const entry = await prisma.waitlist.create({
      data: {
        branchId: body.branchId,
        serviceId: body.serviceId,
        staffId: body.staffId,
        customerId: body.customerId,
        guestName: body.guest?.name,
        guestPhone: body.guest?.phone,
        guestEmail: body.guest?.email,
        desiredDate: body.desiredDate,
        note: body.note,
      },
    });
    await audit("waitlist.create", "Waitlist", entry.id, { actorUserId: req.user?.id, after: { branchId: body.branchId, serviceId: body.serviceId, desiredDate: body.desiredDate }, ip: req.ip });
    return reply.code(201).send(entry);
  });

  app.get("/waitlist", { preHandler: authorize(...STAFF) }, async (req) => {
    const { branchId, status = "WAITING" } = req.query as Record<string, string>;
    const scopedBranch = ["OWNER", "ADMIN"].includes(req.user!.role) ? branchId : req.user!.branchId ?? "__none__";
    return prisma.waitlist.findMany({
      where: { ...(scopedBranch ? { branchId: scopedBranch } : {}), status: status as Prisma.EnumWaitlistStatusFilter["equals"] },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
  });

  // Promote a waitlist entry into a real booking at a now-free slot.
  app.post("/waitlist/:id/promote", { preHandler: authorize(...STAFF) }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const { staffId, startAt } = z.object({ staffId: z.string(), startAt: z.coerce.date() }).parse(req.body);

    const entry = await prisma.waitlist.findUnique({ where: { id } });
    if (!entry || entry.status !== "WAITING") return reply.code(404).send({ error: "not_waiting" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user?.branchId !== entry.branchId) return reply.code(403).send({ error: "forbidden" });
    const branch = await prisma.branch.findUnique({ where: { id: entry.branchId } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });

    try {
      const appt = await prisma.$transaction(
        async (tx) => {
          const slots = await resolveBooking(
            tx as unknown as typeof prisma,
            branch.timezone,
            [{ serviceId: entry.serviceId, staffId, startAt }] as SlotRequest[],
          );
          const created = await tx.appointment.create({
            data: {
              branchId: entry.branchId,
              customerId: entry.customerId,
              guestName: entry.guestName,
              guestPhone: entry.guestPhone,
              guestEmail: entry.guestEmail,
              status: "CONFIRMED",
              startAt: slots[0].startAt,
              endAt: slots[0].endAt,
              items: { create: slots.map((s) => ({ serviceId: s.serviceId, staffId: s.staffId, startAt: s.startAt, endAt: s.endAt, priceMinor: s.priceMinor })) },
              events: { create: { type: "status_change", toStatus: "CONFIRMED", actorUserId: req.user?.id, meta: { source: "waitlist_promote", waitlistId: id } } },
            },
          });
          await tx.waitlist.update({ where: { id }, data: { status: "BOOKED" } });
          return created;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      await enqueueReminder({ appointmentId: appt.id, type: "prev_day" }, new Date(appt.startAt.getTime() - 24 * 3600_000));
      await enqueueReminder({ appointmentId: appt.id, type: "hours_before" }, new Date(appt.startAt.getTime() - 2 * 3600_000));
      await audit("waitlist.promote", "Waitlist", id, { actorUserId: req.user?.id, before: { status: "WAITING" }, after: { status: "BOOKED", appointmentId: appt.id }, ip: req.ip });

      return reply.code(201).send(appt);
    } catch (err) {
      if (err instanceof SlotUnavailableError) return reply.code(409).send({ error: "slot_unavailable", reason: err.reason });
      if ((err as { code?: string }).code === "P2034") return reply.code(409).send({ error: "conflict_retry" });
      throw err;
    }
  });
}
