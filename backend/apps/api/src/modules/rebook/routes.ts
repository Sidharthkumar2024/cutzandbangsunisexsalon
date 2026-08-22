// "Book again" — returns a booking prefill from a customer's most recent visit
// (last non-cancelled appointment's services + the staff who performed them),
// with current price/duration so the UI can drop it straight into the booking
// flow. Read-only; the customer still picks a fresh date/time (slots change).

import { FastifyInstance } from "fastify";
import { prisma } from "@cutz/db";
import { authorize } from "../../plugins/auth.js";

const ACTIVE = ["PENDING", "CONFIRMED", "CHECKED_IN", "IN_SERVICE", "COMPLETED"] as const;

async function buildRebook(customerId: string) {
  const last = await prisma.appointment.findFirst({
    where: { customerId, deletedAt: null, status: { in: [...ACTIVE] } },
    orderBy: { startAt: "desc" },
    include: { items: { include: { service: true, staff: true } } },
  });
  if (!last) return { branchId: null, lastVisitAt: null, services: [] as unknown[] };

  // Only suggest services + staff that are still active/eligible today.
  const services = [];
  for (const it of last.items) {
    if (!it.service || it.service.deletedAt || !it.service.isActive) continue;
    const eligible = await prisma.serviceStaff.findFirst({
      where: { serviceId: it.serviceId, staffId: it.staffId, staff: { isActive: true, deletedAt: null } },
      select: { id: true },
    });
    services.push({
      serviceId: it.serviceId,
      name: it.service.name,
      durationMin: it.service.durationMin,
      priceMinor: it.service.priceMinor,
      staffId: eligible ? it.staffId : null, // staff left / no longer eligible → let UI pick
      staffName: eligible ? it.staff?.displayName ?? null : null,
    });
  }
  return { branchId: last.branchId, lastVisitAt: last.startAt, services };
}

export default async function rebookRoutes(app: FastifyInstance) {
  // Customer portal: rebook for the logged-in customer.
  app.get("/portal/customer/rebook", { preHandler: authorize("CUSTOMER") }, async (req, reply) => {
    const customer = await prisma.customer.findUnique({ where: { userId: req.user!.id }, select: { id: true } });
    if (!customer) return reply.code(404).send({ error: "customer_profile_not_found" });
    return buildRebook(customer.id);
  });

  // Staff/reception: rebook suggestion for a given customer (branch-scoped).
  app.get("/customers/:id/rebook", { preHandler: authorize("OWNER", "ADMIN", "MANAGER", "RECEPTION", "STAFF") }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const customer = await prisma.customer.findUnique({ where: { id }, select: { branchId: true } });
    if (!customer) return reply.code(404).send({ error: "not_found" });
    if (!["OWNER", "ADMIN"].includes(req.user!.role) && req.user!.branchId !== customer.branchId) {
      return reply.code(403).send({ error: "forbidden" });
    }
    return buildRebook(id);
  });
}
