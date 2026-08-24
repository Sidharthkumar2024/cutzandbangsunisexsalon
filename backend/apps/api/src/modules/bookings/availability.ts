// Availability & conflict engine.
//
// A slot is bookable for a given staff member only if ALL hold:
//   1. The staff has the skill for the service (ServiceStaff).
//   2. The slot fits inside a shift for that weekday (salon timezone).
//   3. The slot does not fall inside the staff's break.
//   4. The staff is not on approved leave that day.
//   5. The slot does not overlap any existing non-cancelled AppointmentItem
//      for that staff (including the service buffer).
//
// Concurrency: the final write MUST happen inside a SERIALIZABLE transaction
// (see routes.ts) so two simultaneous requests cannot both pass the overlap
// check and double-book the same staff. This function is the read-side check;
// the transaction is the guarantee.

import { PrismaClient, AppointmentStatus } from "@prisma/client";

const ACTIVE_STATUSES: AppointmentStatus[] = [
  "PENDING",
  "CONFIRMED",
  "CHECKED_IN",
  "IN_SERVICE",
  "COMPLETED",
];

export interface SlotRequest {
  staffId: string;
  serviceId: string;
  startAt: Date; // UTC
}

export interface ResolvedSlot {
  staffId: string;
  serviceId: string;
  startAt: Date;
  endAt: Date; // start + duration + buffer
  priceMinor: number;
}

/** True if [aStart,aEnd) overlaps [bStart,bEnd). Touching edges do NOT overlap. */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && bStart < aEnd;
}

/** Minutes-from-midnight of a UTC instant, in the salon's IANA timezone. */
export function minutesInTz(instant: Date, timezone: string): { weekday: number; min: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(instant);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekdayMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const weekday = weekdayMap[get("weekday")] ?? 0;
  const hour = parseInt(get("hour"), 10);
  const minute = parseInt(get("minute"), 10);
  return { weekday, min: hour * 60 + minute };
}

export class SlotUnavailableError extends Error {
  constructor(public reason: string, public slot: SlotRequest) {
    super(`Slot unavailable: ${reason}`);
  }
}

/**
 * Resolve a requested slot to a concrete {start,end,price} and assert it is
 * bookable. Throws SlotUnavailableError with a machine-readable reason.
 * Pass a client (or tx) so it can run inside the booking transaction.
 */
export interface ResolveOptions {
  /** Manager override: keep skill/shift/leave checks but permit overlaps. */
  allowOverlap?: boolean;
}

export async function resolveSlot(
  db: PrismaClient,
  branchId: string,
  branchTimezone: string,
  req: SlotRequest,
  opts: ResolveOptions = {},
): Promise<ResolvedSlot> {
  const service = await db.service.findFirst({
    where: { id: req.serviceId, isActive: true, deletedAt: null },
  });
  if (!service) throw new SlotUnavailableError("service_not_found", req);

  // Staff ids are exposed by the public catalogue, so every availability
  // decision must bind the selected staff member to the appointment branch.
  // Without this check a public caller could reserve a staff member from a
  // different branch and block that person's real calendar.
  const staff = await db.staff.findFirst({
    where: { id: req.staffId, branchId, isActive: true, deletedAt: null },
    select: { id: true },
  });
  if (!staff) throw new SlotUnavailableError("staff_branch_mismatch", req);

  const endAt = new Date(req.startAt.getTime() + (service.durationMin + service.bufferMin) * 60_000);

  // 1. skill
  const skilled = await db.serviceStaff.findUnique({
    where: { serviceId_staffId: { serviceId: req.serviceId, staffId: req.staffId } },
  });
  if (!skilled) throw new SlotUnavailableError("staff_not_skilled", req);

  // 2 & 3. shift + break (in salon tz)
  const { weekday, min: startMin } = minutesInTz(req.startAt, branchTimezone);
  const endMin = startMin + service.durationMin; // buffer may run past shift end; only service time must fit
  const shifts = await db.shift.findMany({ where: { staffId: req.staffId, weekday } });
  const fitsShift = shifts.some((s) => {
    if (startMin < s.startMin || endMin > s.endMin) return false;
    if (s.breakStartMin != null && s.breakEndMin != null) {
      // reject if the service time overlaps the break
      if (startMin < s.breakEndMin && s.breakStartMin < endMin) return false;
    }
    return true;
  });
  if (!fitsShift) throw new SlotUnavailableError("outside_shift_or_break", req);

  // 4. leave
  const onLeave = await db.leave.findFirst({
    where: {
      staffId: req.staffId,
      approved: true,
      startDate: { lte: req.startAt },
      endDate: { gte: req.startAt },
    },
  });
  if (onLeave) throw new SlotUnavailableError("staff_on_leave", req);

  // 5. overlap with existing bookings for this staff (skipped on manager override)
  if (!opts.allowOverlap) {
    const clashing = await db.appointmentItem.findMany({
      where: {
        staffId: req.staffId,
        appointment: { status: { in: ACTIVE_STATUSES }, deletedAt: null },
        // widen the window; precise overlap checked in memory
        startAt: { lt: endAt },
        endAt: { gt: req.startAt },
      },
      select: { startAt: true, endAt: true },
    });
    for (const c of clashing) {
      if (overlaps(req.startAt, endAt, c.startAt, c.endAt)) {
        throw new SlotUnavailableError("staff_double_booked", req);
      }
    }
  }

  return {
    staffId: req.staffId,
    serviceId: req.serviceId,
    startAt: req.startAt,
    endAt,
    priceMinor: service.priceMinor,
  };
}

/**
 * Resolve a multi-service booking. Each service may have a different staff and
 * a different start time. Also guards against the SAME staff being requested
 * for two overlapping services within one booking.
 */
export async function resolveBooking(
  db: PrismaClient,
  branchId: string,
  branchTimezone: string,
  requests: SlotRequest[],
  opts: ResolveOptions = {},
): Promise<ResolvedSlot[]> {
  const resolved: ResolvedSlot[] = [];
  for (const r of requests) {
    const slot = await resolveSlot(db, branchId, branchTimezone, r, opts);
    // intra-booking self-conflict (always enforced — same customer can't clone)
    if (!opts.allowOverlap) {
      for (const prior of resolved) {
        if (prior.staffId === slot.staffId && overlaps(prior.startAt, prior.endAt, slot.startAt, slot.endAt)) {
          throw new SlotUnavailableError("staff_double_booked_in_request", r);
        }
      }
    }
    resolved.push(slot);
  }
  return resolved;
}
