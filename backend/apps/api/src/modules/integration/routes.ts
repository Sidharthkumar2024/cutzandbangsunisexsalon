// Integration adapter for the Codex `salon` UI.
//
// The salon front-end (lib/client-api.ts) posts to `${NEXT_PUBLIC_API_URL}/api/bookings`
// with its own payload shape and returns `{ reference, status }`. This route
// speaks that exact contract and translates it onto the real, conflict-checked
// booking engine + DB — so the existing UI needs ZERO changes, only its
// NEXT_PUBLIC_API_URL pointed here.

import { FastifyInstance } from "fastify";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@cutz/db";
import { enqueueReminder } from "@cutz/queue";
import { resolveBooking, SlotUnavailableError, SlotRequest } from "../bookings/availability.js";
import { parseDisplayDateTime } from "../../lib/tz.js";
import { audit } from "../../lib/audit.js";

const DEFAULT_BRANCH = process.env.DEFAULT_BRANCH_ID ?? "main";

// Matches lib/client-api.ts BookingPayload exactly.
const payloadSchema = z.object({
  audience: z.string().optional(),
  services: z.array(z.object({ id: z.string(), staffId: z.string() })).min(1),
  date: z.string().optional(),
  time: z.string().optional(),
  startAt: z.coerce.date().optional(),
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().min(1),
    email: z.string().email().optional().or(z.literal("")),
  }),
}).superRefine((value, ctx) => {
  if (!value.startAt && (!value.date || !value.time)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "startAt or date/time is required", path: ["startAt"] });
  }
});

export default async function integrationRoutes(app: FastifyInstance) {
  app.post("/bookings", { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } }, async (req, reply) => {
    const parsed = payloadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "Missing required booking details" });
    }
    const body = parsed.data;

    const branch = await prisma.branch.findUnique({ where: { id: DEFAULT_BRANCH } });
    if (!branch) return reply.code(500).send({ error: "branch_not_configured" });

    // Resolve display date + time -> UTC start instant.
    let startAt: Date;
    try {
      startAt = body.startAt ?? parseDisplayDateTime(body.date!, body.time!, branch.timezone, new Date());
    } catch {
      return reply.code(400).send({ error: "Could not understand the selected date or time" });
    }

    // Multi-service: chain services sequentially for the same customer, using
    // each service's real duration + buffer. (One customer can't be in two
    // chairs at once, so services run back-to-back.)
    const serviceIds = body.services.map((s) => s.id);
    const services = await prisma.service.findMany({ where: { id: { in: serviceIds }, isActive: true, deletedAt: null } });
    const byId = new Map(services.map((s) => [s.id, s]));
    if (serviceIds.some((id) => !byId.has(id))) {
      return reply.code(400).send({ error: "One or more selected services are unavailable" });
    }

    const items: SlotRequest[] = [];
    let cursor = startAt;
    for (const sel of body.services) {
      const svc = byId.get(sel.id)!;
      items.push({ serviceId: sel.id, staffId: sel.staffId, startAt: cursor });
      cursor = new Date(cursor.getTime() + (svc.durationMin + svc.bufferMin) * 60_000);
    }

    try {
      const appt = await prisma.$transaction(
        async (tx) => {
          const slots = await resolveBooking(tx as unknown as typeof prisma, branch.timezone, items);
          const endAt = new Date(Math.max(...slots.map((s) => s.endAt.getTime())));
          return tx.appointment.create({
            data: {
              branchId: branch.id,
              guestName: body.customer.name,
              guestPhone: body.customer.phone,
              guestEmail: body.customer.email || undefined,
              status: "CONFIRMED", // online bookings are auto-confirmed
              startAt: slots[0].startAt,
              endAt,
              notes: body.audience ? `Audience: ${body.audience}` : undefined,
              items: {
                create: slots.map((s) => ({
                  serviceId: s.serviceId,
                  staffId: s.staffId,
                  startAt: s.startAt,
                  endAt: s.endAt,
                  priceMinor: s.priceMinor,
                })),
              },
              events: { create: { type: "status_change", toStatus: "CONFIRMED", meta: { source: "web" } } },
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      // Fire reminders (idempotent job ids).
      await enqueueReminder({ appointmentId: appt.id, type: "prev_day" }, new Date(appt.startAt.getTime() - 24 * 3600_000));
      await enqueueReminder({ appointmentId: appt.id, type: "hours_before" }, new Date(appt.startAt.getTime() - 2 * 3600_000));
      await audit("appointment.create", "Appointment", appt.id, { after: { branchId: branch.id, startAt: appt.startAt, endAt: appt.endAt, source: "web" }, ip: req.ip });

      const reference = `CB-${appt.id.slice(-6).toUpperCase()}`;
      // Return `id` too: the Codex salon proxy reads `result.id` as the
      // customer-facing reference, so surface the friendly code there as well.
      return reply.code(201).send({ id: reference, reference, status: "confirmed", appointmentId: appt.id });
    } catch (err) {
      if (err instanceof SlotUnavailableError) {
        return reply.code(409).send({ error: "We could not confirm that time. Please try another slot.", reason: err.reason });
      }
      if ((err as { code?: string }).code === "P2034") {
        return reply.code(409).send({ error: "That slot was just taken. Please try again." });
      }
      throw err;
    }
  });
}
