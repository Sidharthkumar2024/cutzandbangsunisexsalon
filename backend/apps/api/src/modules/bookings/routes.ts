import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { enqueueReminder, cancelReminders } from "@cutz/queue";
import { authorize } from "../../plugins/auth.js";
import { resolveBooking, SlotUnavailableError, SlotRequest } from "./availability.js";
import { audit } from "../../lib/audit.js";

/** Schedule prev-day + hours-before reminders for a confirmed appointment. */
async function scheduleReminders(appointmentId: string, startAt: Date) {
  const prevDay = new Date(startAt.getTime() - 24 * 3600_000);
  const hoursBefore = new Date(startAt.getTime() - 2 * 3600_000);
  await enqueueReminder({ appointmentId, type: "prev_day" }, prevDay);
  await enqueueReminder({ appointmentId, type: "hours_before" }, hoursBefore);
}

const bookingSchema = z.object({
  branchId: z.string(),
  customerId: z.string().optional(),
  guest: z
    .object({ name: z.string(), phone: z.string(), email: z.string().email().optional() })
    .optional(),
  isWalkIn: z.boolean().default(false),
  // Manager override: book past a conflict. Requires a manager+ session.
  override: z.boolean().optional(),
  items: z
    .array(
      z.object({
        serviceId: z.string(),
        staffId: z.string(),
        startAt: z.coerce.date(),
      }),
    )
    .min(1),
});

const MANAGER_ROLES = ["OWNER", "ADMIN", "MANAGER"];

export default async function bookingRoutes(app: FastifyInstance) {
  // List appointments for the calendar / day view.
  app.get(
    "/appointments",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") },
    async (req) => {
      const { branchId, from, to, staffId } = req.query as Record<string, string>;
      const where: Prisma.AppointmentWhereInput = { deletedAt: null };
      const scopedBranch = ["OWNER", "ADMIN"].includes(req.user!.role) ? branchId : req.user!.branchId;
      if (scopedBranch) where.branchId = scopedBranch;
      if (from || to) where.startAt = { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lt: new Date(to) } : {}) };
      const ownStaff = req.user!.role === "STAFF" ? await prisma.staff.findUnique({ where: { userId: req.user!.id }, select: { id: true } }) : null;
      if (req.user!.role === "STAFF" && !ownStaff) return [];
      if (staffId || ownStaff) where.items = { some: { staffId: ownStaff?.id ?? staffId } };
      return prisma.appointment.findMany({
        where,
        orderBy: { startAt: "asc" },
        take: 500,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          items: { include: { service: { select: { name: true } }, staff: { select: { displayName: true } } } },
        },
      });
    },
  );

  // Public/guest booking is allowed; staff endpoints reuse the same engine.
  app.post("/bookings", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const parsed = bookingSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid", details: parsed.error.flatten() });
    const body = parsed.data;

    const branch = await prisma.branch.findUnique({ where: { id: body.branchId } });
    if (!branch) return reply.code(404).send({ error: "branch_not_found" });
    if (body.isWalkIn && !req.user) return reply.code(401).send({ error: "walk_in_requires_staff" });
    if (req.user && !["OWNER", "ADMIN", "SUPERADMIN"].includes(req.user.role) && req.user.branchId !== body.branchId) return reply.code(403).send({ error: "forbidden" });

    if (!body.customerId && !body.guest) {
      return reply.code(400).send({ error: "customer_or_guest_required" });
    }
    if (body.customerId) {
      if (!req.user) return reply.code(401).send({ error: "customer_booking_requires_session" });
      const customer = await prisma.customer.findUnique({ where: { id: body.customerId }, select: { userId: true, branchId: true } });
      if (!customer) return reply.code(404).send({ error: "customer_not_found" });
      if (req.user.role === "CUSTOMER" && customer.userId !== req.user.id) return reply.code(403).send({ error: "forbidden" });
      if (!["OWNER", "ADMIN", "SUPERADMIN"].includes(req.user.role) && customer.branchId !== req.user.branchId) return reply.code(403).send({ error: "forbidden" });
    }

    // Manager override is permissioned: only a manager+ session may force a
    // booking past a conflict, and it is always audited via an appointment event.
    let allowOverlap = false;
    if (body.override) {
      if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
        return reply.code(403).send({ error: "override_requires_manager" });
      }
      allowOverlap = true;
    }

    try {
      // SERIALIZABLE so two concurrent bookings cannot both pass the overlap
      // check. On write-conflict Postgres aborts one; we surface it as 409.
      const appt = await prisma.$transaction(
        async (tx) => {
          const slots = await resolveBooking(
            tx as unknown as typeof prisma,
            branch.timezone,
            body.items as SlotRequest[],
            { allowOverlap },
          );
          const startAt = new Date(Math.min(...slots.map((s) => s.startAt.getTime())));
          const endAt = new Date(Math.max(...slots.map((s) => s.endAt.getTime())));

          return tx.appointment.create({
            data: {
              branchId: body.branchId,
              customerId: body.customerId,
              guestName: body.guest?.name,
              guestPhone: body.guest?.phone,
              guestEmail: body.guest?.email,
              isWalkIn: body.isWalkIn,
              status: body.isWalkIn ? "CHECKED_IN" : "PENDING",
              startAt,
              endAt,
              items: {
                create: slots.map((s) => ({
                  serviceId: s.serviceId,
                  staffId: s.staffId,
                  startAt: s.startAt,
                  endAt: s.endAt,
                  priceMinor: s.priceMinor,
                })),
              },
              events: {
                create: [
                  { type: "status_change", toStatus: body.isWalkIn ? "CHECKED_IN" : "PENDING" },
                  ...(allowOverlap
                    ? [{ type: "override", actorUserId: req.user?.id, meta: { reason: "manager_override_conflict" } }]
                    : []),
                ],
              },
            },
            include: { items: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Reminders are scheduled after the booking commits. Idempotent job ids
      // mean this is safe even if the request is retried.
      if (!body.isWalkIn) await scheduleReminders(appt.id, appt.startAt);
      await audit("appointment.create", "Appointment", appt.id, { actorUserId: req.user?.id, after: { branchId: body.branchId, startAt: appt.startAt, endAt: appt.endAt, isWalkIn: body.isWalkIn }, ip: req.ip });

      return reply.code(201).send(appt);
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return reply.code(409).send({ error: "slot_unavailable", reason: err.reason, slot: err.slot });
      }
      // Postgres serialization failure => ask client to retry
      if ((err as { code?: string }).code === "P2034") {
        return reply.code(409).send({ error: "conflict_retry" });
      }
      throw err;
    }
  });

  // Status transitions with audit event.
  app.patch(
    "/appointments/:id/status",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { status } = z
        .object({
          status: z.enum([
            "PENDING", "CONFIRMED", "CHECKED_IN", "IN_SERVICE", "COMPLETED", "CANCELLED", "NO_SHOW",
          ]),
        })
        .parse(req.body);

      const existing = await prisma.appointment.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: "not_found" });
      if (!["OWNER", "ADMIN", "SUPERADMIN"].includes(req.user!.role) && req.user!.branchId !== existing.branchId) return reply.code(403).send({ error: "forbidden" });
      if (req.user!.role === "STAFF") {
        const assigned = await prisma.appointmentItem.findFirst({ where: { appointmentId: id, staff: { userId: req.user!.id } }, select: { id: true } });
        if (!assigned) return reply.code(403).send({ error: "forbidden" });
      }

      const updated = await prisma.appointment.update({
        where: { id },
        data: {
          status,
          events: {
            create: {
              type: "status_change",
              fromStatus: existing.status,
              toStatus: status,
              actorUserId: req.user?.id,
            },
          },
        },
      });

      // Stop pending reminders once the appointment is terminal.
      if (["CANCELLED", "NO_SHOW", "COMPLETED"].includes(status)) {
        await cancelReminders(id);
      }
      await audit("appointment.status", "Appointment", id, { actorUserId: req.user?.id, before: { status: existing.status }, after: { status }, ip: req.ip });
      return updated;
    },
  );

  // Reschedule: move an appointment's item(s) to new slot(s), re-checking
  // conflicts in a SERIALIZABLE txn, then re-arm reminders. Audited.
  app.patch(
    "/appointments/:id/reschedule",
    { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION") },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = z
        .object({
          items: z.array(z.object({ serviceId: z.string(), staffId: z.string(), startAt: z.coerce.date() })).min(1),
          override: z.boolean().optional(),
        })
        .parse(req.body);

      const existing = await prisma.appointment.findUnique({ where: { id }, include: { items: true } });
      if (!existing || existing.deletedAt) return reply.code(404).send({ error: "not_found" });
      if (!["OWNER", "ADMIN", "SUPERADMIN"].includes(req.user!.role) && req.user!.branchId !== existing.branchId) return reply.code(403).send({ error: "forbidden" });
      if (["COMPLETED", "CANCELLED", "NO_SHOW"].includes(existing.status)) {
        return reply.code(409).send({ error: "cannot_reschedule_terminal_appointment" });
      }
      const branch = await prisma.branch.findUnique({ where: { id: existing.branchId } });
      if (!branch) return reply.code(404).send({ error: "branch_not_found" });

      let allowOverlap = false;
      if (body.override) {
        if (!req.user || !MANAGER_ROLES.includes(req.user.role)) {
          return reply.code(403).send({ error: "override_requires_manager" });
        }
        allowOverlap = true;
      }

      try {
        const updated = await prisma.$transaction(
          async (tx) => {
            // Exclude this appointment's own items from the conflict check by
            // soft-detaching them first (delete + recreate) inside the txn.
            await tx.appointmentItem.deleteMany({ where: { appointmentId: id } });
            const slots = await resolveBooking(
              tx as unknown as typeof prisma,
              branch.timezone,
              body.items as SlotRequest[],
              { allowOverlap },
            );
            const startAt = new Date(Math.min(...slots.map((s) => s.startAt.getTime())));
            const endAt = new Date(Math.max(...slots.map((s) => s.endAt.getTime())));
            return tx.appointment.update({
              where: { id },
              data: {
                startAt,
                endAt,
                items: {
                  create: slots.map((s) => ({
                    serviceId: s.serviceId,
                    staffId: s.staffId,
                    startAt: s.startAt,
                    endAt: s.endAt,
                    priceMinor: s.priceMinor,
                  })),
                },
                events: {
                  create: {
                    type: "reschedule",
                    actorUserId: req.user?.id,
                    meta: { from: existing.startAt.toISOString(), to: startAt.toISOString(), override: allowOverlap },
                  },
                },
              },
              include: { items: true },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );

        // Re-arm reminders for the new time (deterministic ids overwrite old).
        await cancelReminders(id);
        if (!existing.isWalkIn) await scheduleReminders(id, updated.startAt);
        await audit("appointment.reschedule", "Appointment", id, { actorUserId: req.user?.id, before: { startAt: existing.startAt, endAt: existing.endAt }, after: { startAt: updated.startAt, endAt: updated.endAt, override: allowOverlap }, ip: req.ip });

        return updated;
      } catch (err) {
        if (err instanceof SlotUnavailableError) {
          return reply.code(409).send({ error: "slot_unavailable", reason: err.reason });
        }
        if ((err as { code?: string }).code === "P2034") {
          return reply.code(409).send({ error: "conflict_retry" });
        }
        throw err;
      }
    },
  );
}
