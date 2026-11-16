import "server-only";
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  bookings,
  customerRecords,
  services,
  type Appointment,
  type Booking,
} from "@/db/schema";
import type { BusinessScope } from "@/db/scope";
import { grantFor } from "@/modules/identity/permissions";
import { queueBookingMessages } from "@/modules/messaging/queue";

/**
 * The business's side of bookings (F16, the start of F23): seeing what is
 * coming, approving or declining requests, cancelling. Everything goes
 * through the scope, so one business can never reach another's bookings.
 */

export type StaffBooking = {
  id: string;
  status: Booking["status"];
  startsAt: Date;
  endsAt: Date;
  serviceName: string;
  /** Who performs it, and whether the customer asked for her or the system picked. */
  professionalName: string | null;
  professionalUserId: string | null;
  assignment: Appointment["assignment"];
  customerRecordId: string | null;
  /** The name and phone typed when booking. */
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  customerNotes: string | null;
  /** From her record: safety information for whoever serves her (D43). */
  allergies: string | null;
  atClientPlace: boolean;
  clientAddressText: string | null;
  totalPrice: number;
  currency: string;
  createdAt: Date;
};

export type ManageError =
  | "forbidden"
  | "not_found"
  | "wrong_status"
  /** Completing or marking a no-show before the visit has started. */
  | "not_started"
  | "amount_invalid"
  | "method_invalid";

/** How a customer paid. Recorded with the amount when a visit is completed (D59). */
export const PAYMENT_METHODS = ["cash", "telebirr", "bank_transfer", "other"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export type ManageResult = { ok: true } | { ok: false; error: ManageError };

/** Statuses that still have a visit ahead of them. */
const LIVE = ["pending_approval", "confirmed", "arrived"] as const;

/**
 * A request nobody answered before its start time has lapsed: it is marked
 * expired and its time freed, so it stops asking for approval.
 */
async function expireUnansweredRequests(scope: BusinessScope, now: Date) {
  const pending = await scope.select(bookings, eq(bookings.status, "pending_approval"));
  if (pending.length === 0) return;
  const started = await scope.select(
    appointments,
    and(
      inArray(
        appointments.bookingId,
        pending.map((booking) => booking.id),
      ),
      lt(appointments.startsAt, now),
    ),
  );
  const ids = [...new Set(started.map((appointment) => appointment.bookingId))];
  if (ids.length === 0) return;
  await scope.transaction(async (scoped) => {
    await scoped.update(
      bookings,
      { status: "expired", cancelledBy: "system", cancelledAt: now, updatedAt: now },
      and(inArray(bookings.id, ids), eq(bookings.status, "pending_approval")),
    );
    await scoped.update(appointments, { status: "cancelled" }, inArray(appointments.bookingId, ids));
  });
}

/**
 * Bookings still open from `from` onwards: requests waiting for approval,
 * and confirmed or arrived visits (including past ones nobody has closed
 * yet), soonest first. A stylist sees only her own (playbook 14.3).
 */
export async function listUpcomingBookings(
  scope: BusinessScope,
  from: Date,
  now = new Date(),
): Promise<StaffBooking[]> {
  const grant = grantFor(scope.actor.role, "bookings.view");
  if (!grant || !scope.can("bookings.view")) return [];

  await expireUnansweredRequests(scope, now);

  const upcoming = await scope.select(
    appointments,
    and(eq(appointments.status, "active"), gte(appointments.startsAt, from)),
  );
  const visible = upcoming.filter(
    (appointment) => grant !== "own" || appointment.professionalUserId === scope.actor.userId,
  );
  if (visible.length === 0) return [];

  const [rows, serviceRows, members] = await Promise.all([
    scope.select(
      bookings,
      and(
        inArray(bookings.id, [...new Set(visible.map((appointment) => appointment.bookingId))]),
        inArray(bookings.status, LIVE),
      ),
    ),
    scope.select(services),
    scope.members(),
  ]);
  const recordIds = rows.flatMap((row) => (row.customerRecordId ? [row.customerRecordId] : []));
  const records = recordIds.length
    ? await scope.select(customerRecords, inArray(customerRecords.id, recordIds))
    : [];

  const bookingById = new Map(rows.map((row) => [row.id, row]));
  const serviceName = new Map(serviceRows.map((row) => [row.id, row.name]));
  const memberName = new Map(members.map((member) => [member.membershipId, member.displayName]));
  const allergies = new Map(records.map((record) => [record.id, record.allergies]));

  return visible
    .flatMap((appointment): StaffBooking[] => {
      const booking = bookingById.get(appointment.bookingId);
      if (!booking) return [];
      return [
        {
          id: booking.id,
          status: booking.status,
          startsAt: appointment.startsAt,
          endsAt: appointment.endsAt,
          serviceName: serviceName.get(appointment.serviceId) ?? "",
          professionalName: appointment.membershipId
            ? (memberName.get(appointment.membershipId) ?? null)
            : null,
          professionalUserId: appointment.professionalUserId,
          assignment: appointment.assignment,
          customerRecordId: booking.customerRecordId,
          customerName: booking.customerName,
          customerPhone: booking.customerPhone,
          customerEmail: booking.customerEmail,
          customerNotes: booking.customerNotes,
          allergies: booking.customerRecordId
            ? (allergies.get(booking.customerRecordId) ?? null)
            : null,
          atClientPlace: booking.atClientPlace,
          clientAddressText: booking.clientAddressText,
          totalPrice: booking.totalPrice,
          currency: booking.currency,
          createdAt: booking.createdAt,
        },
      ];
    })
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** The booking and its appointment, if the actor may act on it. */
async function loadForChange(
  scope: BusinessScope,
  bookingId: string,
  action: "bookings.create" | "bookings.complete" = "bookings.create",
) {
  if (!z.uuid().safeParse(bookingId).success) return { ok: false as const, error: "not_found" as const };
  const [booking] = await scope.select(bookings, eq(bookings.id, bookingId));
  if (!booking) return { ok: false as const, error: "not_found" as const };
  const [appointment] = await scope.select(appointments, eq(appointments.bookingId, bookingId));
  // Whoever may take bookings may answer them, and whoever may complete visits
  // may close them: the owner and front desk for everyone, a stylist for her
  // own (playbook 8.9, 14.3).
  if (!scope.can(action, { professionalUserId: appointment?.professionalUserId })) {
    return { ok: false as const, error: "forbidden" as const };
  }
  return { ok: true as const, booking, appointment };
}

/** Confirms a request that was waiting for approval (F16). */
export async function approveBooking(
  scope: BusinessScope,
  bookingId: string,
  now = new Date(),
): Promise<ManageResult> {
  const found = await loadForChange(scope, bookingId);
  if (!found.ok) return found;
  if (found.booking.status !== "pending_approval") return { ok: false, error: "wrong_status" };

  return scope.transaction(async (scoped): Promise<ManageResult> => {
    const [updated] = await scoped.update(
      bookings,
      { status: "confirmed", approvedAt: now, approvedByUserId: scope.actor.userId, updatedAt: now },
      and(eq(bookings.id, bookingId), eq(bookings.status, "pending_approval")),
    );
    if (!updated) return { ok: false, error: "wrong_status" };
    await scoped.log({
      action: "booking.approved",
      entityType: "booking",
      entityId: bookingId,
      before: { status: "pending_approval" },
      after: { status: "confirmed" },
    });
    return { ok: true };
  }).then(async (result) => {
    if (result.ok) await queueBookingMessages("approved", bookingId, { now });
    return result;
  });
}

/**
 * Cancels on the business's side and frees the time: declining a request,
 * or cancelling a confirmed visit. The customer sees it on her booking link.
 */
export async function cancelBookingByBusiness(
  scope: BusinessScope,
  bookingId: string,
  reason?: string,
  now = new Date(),
): Promise<ManageResult> {
  const found = await loadForChange(scope, bookingId);
  if (!found.ok) return found;
  const { status } = found.booking;
  if (status !== "pending_approval" && status !== "confirmed") {
    return { ok: false, error: "wrong_status" };
  }

  return scope.transaction(async (scoped): Promise<ManageResult> => {
    const [updated] = await scoped.update(
      bookings,
      {
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: "business",
        cancelReason: reason?.trim().slice(0, 300) || null,
        updatedAt: now,
      },
      and(eq(bookings.id, bookingId), eq(bookings.status, status)),
    );
    if (!updated) return { ok: false, error: "wrong_status" };
    await scoped.update(appointments, { status: "cancelled" }, eq(appointments.bookingId, bookingId));
    await scoped.log({
      action: status === "pending_approval" ? "booking.declined" : "booking.cancelled_by_business",
      entityType: "booking",
      entityId: bookingId,
      before: { status },
      after: { status: "cancelled" },
    });
    return { ok: true };
  }).then(async (result) => {
    if (result.ok) {
      await queueBookingMessages(
        status === "pending_approval" ? "declined" : "cancelled_by_business",
        bookingId,
        { now },
      );
    }
    return result;
  });
}

/** The customer has come in (playbook 8.12). Only on the day of the visit. */
export async function markArrived(
  scope: BusinessScope,
  bookingId: string,
  now = new Date(),
): Promise<ManageResult> {
  const found = await loadForChange(scope, bookingId, "bookings.complete");
  if (!found.ok) return found;
  if (found.booking.status !== "confirmed") return { ok: false, error: "wrong_status" };
  // Not more than a few hours early: "arrived" is for the visit at hand, not one next week.
  const startsAt = found.appointment?.startsAt;
  if (!startsAt || startsAt.getTime() - now.getTime() > 12 * 60 * 60_000) {
    return { ok: false, error: "not_started" };
  }

  return scope.transaction(async (scoped): Promise<ManageResult> => {
    const [updated] = await scoped.update(
      bookings,
      { status: "arrived", updatedAt: now },
      and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed")),
    );
    if (!updated) return { ok: false, error: "wrong_status" };
    await scoped.log({
      action: "booking.arrived",
      entityType: "booking",
      entityId: bookingId,
      before: { status: "confirmed" },
      after: { status: "arrived" },
    });
    return { ok: true };
  });
}

/**
 * Closes a visit with what was paid and how (D59: both are required, because
 * the income figures are built on them). The customer's record gains the
 * visit and the amount.
 */
export async function completeBooking(
  scope: BusinessScope,
  bookingId: string,
  payment: { amountPaid: number; method: string },
  now = new Date(),
): Promise<ManageResult> {
  if (!Number.isInteger(payment.amountPaid) || payment.amountPaid < 0 || payment.amountPaid > 100_000_000) {
    return { ok: false, error: "amount_invalid" };
  }
  const method = PAYMENT_METHODS.find((value) => value === payment.method);
  if (!method) return { ok: false, error: "method_invalid" };

  const found = await loadForChange(scope, bookingId, "bookings.complete");
  if (!found.ok) return found;
  const { booking, appointment } = found;
  if (booking.status !== "confirmed" && booking.status !== "arrived") {
    return { ok: false, error: "wrong_status" };
  }
  if (!appointment || appointment.startsAt > now) return { ok: false, error: "not_started" };

  return scope.transaction(async (scoped): Promise<ManageResult> => {
    const [updated] = await scoped.update(
      bookings,
      {
        status: "completed",
        amountPaid: payment.amountPaid,
        paymentMethod: method,
        completedAt: now,
        completedByUserId: scope.actor.userId,
        updatedAt: now,
      },
      and(eq(bookings.id, bookingId), inArray(bookings.status, ["confirmed", "arrived"])),
    );
    if (!updated) return { ok: false, error: "wrong_status" };

    if (booking.customerRecordId) {
      await scoped.update(
        customerRecords,
        {
          visitCount: sql`${customerRecords.visitCount} + 1`,
          totalSpent: sql`${customerRecords.totalSpent} + ${payment.amountPaid}`,
          // Completing an older visit late must not move "last visit" backwards.
          lastVisitAt: sql`greatest(${customerRecords.lastVisitAt}, ${appointment.startsAt.toISOString()}::timestamptz)`,
          updatedAt: now,
        },
        eq(customerRecords.id, booking.customerRecordId),
      );
    }
    await scoped.log({
      action: "booking.completed",
      entityType: "booking",
      entityId: bookingId,
      before: { status: booking.status },
      after: { status: "completed", amountPaid: payment.amountPaid, paymentMethod: method },
    });
    return { ok: true };
  });
}

/** The customer did not come. Recorded on her record at this business (playbook 8.12). */
export async function markNoShow(
  scope: BusinessScope,
  bookingId: string,
  now = new Date(),
): Promise<ManageResult> {
  const found = await loadForChange(scope, bookingId, "bookings.complete");
  if (!found.ok) return found;
  const { booking, appointment } = found;
  if (booking.status !== "confirmed") return { ok: false, error: "wrong_status" };
  if (!appointment || appointment.startsAt > now) return { ok: false, error: "not_started" };

  return scope.transaction(async (scoped): Promise<ManageResult> => {
    const [updated] = await scoped.update(
      bookings,
      { status: "no_show", updatedAt: now },
      and(eq(bookings.id, bookingId), eq(bookings.status, "confirmed")),
    );
    if (!updated) return { ok: false, error: "wrong_status" };
    if (booking.customerRecordId) {
      await scoped.update(
        customerRecords,
        { noShowCount: sql`${customerRecords.noShowCount} + 1`, updatedAt: now },
        eq(customerRecords.id, booking.customerRecordId),
      );
    }
    await scoped.log({
      action: "booking.no_show",
      entityType: "booking",
      entityId: bookingId,
      before: { status: "confirmed" },
      after: { status: "no_show" },
    });
    return { ok: true };
  });
}

/** Whether new bookings are confirmed at once or wait for someone to approve them (F16). */
export async function setApprovalMode(
  scope: BusinessScope,
  mode: "auto" | "manual",
): Promise<ManageResult> {
  if (!scope.can("settings.manage")) return { ok: false, error: "forbidden" };
  if (mode !== "auto" && mode !== "manual") return { ok: false, error: "wrong_status" };
  const before = (await scope.business()).approvalMode;
  if (before === mode) return { ok: true };
  await scope.transaction(async (scoped) => {
    await scoped.updateBusiness({ approvalMode: mode });
    await scoped.log({
      action: "approval_mode.updated",
      entityType: "business",
      entityId: scope.businessId,
      before: { approvalMode: before },
      after: { approvalMode: mode },
    });
  });
  return { ok: true };
}
