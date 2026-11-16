import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { db, type DbExecutor } from "@/db/client";
import { appointments, bookings, businesses, messages, users, type MessageKind } from "@/db/schema";

/**
 * Writing messages about bookings (F26). This is the only place that queues
 * them (technical-plan Section 8): a row in `messages` per recipient, which
 * the delivery job sends when it is due. Who gets what:
 *
 * - The customer, by email if she gave one (D90; Telegram and SMS come later).
 * - The professional doing the visit and the owner, by their verified email.
 *
 * Platform code: it runs for guests (no scope) and reads people's emails.
 */

export type BookingEvent =
  /** The customer finished booking; confirmed, or waiting for approval. */
  | "booked"
  | "approved"
  | "declined"
  | "cancelled_by_business"
  | "cancelled_by_customer";

/** One reminder, this long before the start (D102). */
export const REMINDER_BEFORE_MS = 24 * 60 * 60_000;

/** Called after each new message, so the delivery job runs soon rather than within the minute. */
let kick: (() => void) | null = null;
export function onMessageQueued(callback: () => void) {
  kick = callback;
}

type Row = typeof messages.$inferInsert;

async function loadBooking(bookingId: string, executor: DbExecutor) {
  const [row] = await executor
    .select({
      booking: bookings,
      startsAt: appointments.startsAt,
      professionalUserId: appointments.professionalUserId,
      ownerUserId: businesses.ownerUserId,
    })
    .from(bookings)
    .innerJoin(appointments, eq(appointments.bookingId, bookings.id))
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .where(eq(bookings.id, bookingId))
    .orderBy(asc(appointments.startsAt))
    .limit(1);
  return row ?? null;
}

/** The professional doing the visit and the owner, each once, by verified email. */
async function staffRecipients(userIds: (string | null)[], executor: DbExecutor) {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return [];
  return executor
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(inArray(users.id, ids), isNotNull(users.email), isNotNull(users.emailVerifiedAt)));
}

/** Stops reminders still waiting for a booking that will no longer happen. */
async function cancelPendingReminders(bookingId: string, executor: DbExecutor) {
  await executor
    .update(messages)
    .set({ status: "cancelled", updatedAt: new Date() })
    .where(
      and(
        eq(messages.bookingId, bookingId),
        eq(messages.kind, "booking_reminder"),
        eq(messages.status, "queued"),
      ),
    );
}

const CUSTOMER_KIND: Record<Exclude<BookingEvent, "cancelled_by_customer">, MessageKind | null> = {
  booked: null, // depends on the status
  approved: "booking_approved",
  declined: "booking_declined",
  cancelled_by_business: "booking_cancelled_by_business",
};

/**
 * Queues the messages for something that happened to a booking. `linkToken`
 * is the customer's private booking link, known only when she has just
 * booked; it goes in her first email and nowhere else.
 */
export async function queueBookingMessages(
  event: BookingEvent,
  bookingId: string,
  options: { linkToken?: string; now?: Date } = {},
  executor: DbExecutor = db,
): Promise<number> {
  const now = options.now ?? new Date();
  const found = await loadBooking(bookingId, executor);
  if (!found) return 0;
  const { booking, startsAt } = found;
  const base = {
    businessId: booking.businessId,
    bookingId: booking.id,
    customerRecordId: booking.customerRecordId,
    // Due straight away, unless a row says otherwise (reminders).
    scheduledFor: now,
  };
  const rows: Row[] = [];
  const toCustomer = (kind: MessageKind, extra: Partial<Row> = {}) => {
    if (booking.customerEmail) {
      rows.push({ ...base, kind, channel: "email", recipient: booking.customerEmail, ...extra });
    }
  };
  const reminder = () => {
    const at = new Date(startsAt.getTime() - REMINDER_BEFORE_MS);
    // Booked less than a day ahead: the confirmation is reminder enough.
    if (at > now) toCustomer("booking_reminder", { scheduledFor: at });
  };

  if (event === "booked") {
    const confirmed = booking.status === "confirmed";
    toCustomer(confirmed ? "booking_confirmation" : "booking_request_received", {
      linkToken: options.linkToken ?? null,
    });
    if (confirmed) reminder();
  } else if (event === "approved") {
    toCustomer("booking_approved");
    reminder();
  } else if (event !== "cancelled_by_customer") {
    toCustomer(CUSTOMER_KIND[event]!);
  }

  if (event === "booked" || event === "cancelled_by_customer") {
    const staff = await staffRecipients([found.professionalUserId, found.ownerUserId], executor);
    for (const person of staff) {
      rows.push({
        ...base,
        kind: event === "booked" ? "new_booking_notice" : "booking_cancelled_notice",
        channel: "email",
        recipient: person.email!,
        userId: person.id,
      });
    }
  }

  if (event === "declined" || event === "cancelled_by_business" || event === "cancelled_by_customer") {
    await cancelPendingReminders(booking.id, executor);
  }

  if (rows.length > 0) {
    await executor.insert(messages).values(rows);
    kick?.();
  }
  return rows.length;
}
