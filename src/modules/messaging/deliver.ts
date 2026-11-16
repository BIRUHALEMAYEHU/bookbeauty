import "server-only";
import { and, asc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  appointments,
  bookings,
  businesses,
  messages,
  professionalProfiles,
  services,
  users,
  type Message,
} from "@/db/schema";
import { sendEmail } from "@/integrations/email";
import { sendTelegramMessage } from "@/integrations/telegram";
import { BUSINESS_KINDS, composeEmail, type BookingFacts } from "./compose";
import { customerTarget, staffTargets } from "./recipients";
import { markChatBlocked } from "./telegram";

/**
 * Sends queued messages that are due (technical-plan Section 8). Run by the
 * background job every minute and right after something is queued; safe to
 * run on several servers at once, because each message is claimed by one.
 */

export const MAX_ATTEMPTS = 5;
const BATCH = 20;
/** A message claimed this long ago by a worker that then stopped is put back. */
const STUCK_MS = 10 * 60_000;

/** Waits between tries: 1, 4, 9, 16 minutes. */
function retryDelayMs(attempts: number) {
  return attempts * attempts * 60_000;
}

/** Takes up to BATCH due messages, marking them as being sent so no other worker takes them. */
async function claimDue(now: Date, businessId?: string): Promise<Message[]> {
  return db
    .update(messages)
    .set({ status: "sending", attempts: sql`${messages.attempts} + 1`, updatedAt: now })
    .where(
      inArray(
        messages.id,
        db
          .select({ id: messages.id })
          .from(messages)
          .where(
            and(
              eq(messages.status, "queued"),
              lte(messages.scheduledFor, now),
              businessId ? eq(messages.businessId, businessId) : undefined,
            ),
          )
          .orderBy(asc(messages.scheduledFor))
          .limit(BATCH)
          .for("update", { skipLocked: true }),
      ),
    )
    .returning();
}

async function releaseStuck(now: Date) {
  await db
    .update(messages)
    .set({ status: "queued", updatedAt: now })
    .where(and(eq(messages.status, "sending"), lt(messages.updatedAt, new Date(now.getTime() - STUCK_MS))));
}

/** What a message needs to say about its booking, read fresh when it is sent. */
async function loadFacts(bookingId: string): Promise<BookingFacts | null> {
  const [row] = await db
    .select({
      booking: bookings,
      startsAt: appointments.startsAt,
      endsAt: appointments.endsAt,
      assignment: appointments.assignment,
      businessName: businesses.name,
      timeZone: businesses.timeZone,
      serviceName: services.name,
      professionalName: professionalProfiles.displayName,
    })
    .from(bookings)
    .innerJoin(appointments, eq(appointments.bookingId, bookings.id))
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(professionalProfiles, eq(professionalProfiles.userId, appointments.professionalUserId))
    .where(eq(bookings.id, bookingId))
    .orderBy(asc(appointments.startsAt))
    .limit(1);
  if (!row) return null;
  const { booking } = row;
  return {
    businessId: booking.businessId,
    businessName: row.businessName,
    timeZone: row.timeZone,
    serviceName: row.serviceName,
    startsAt: row.startsAt,
    durationMinutes: Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / 60_000),
    professionalName: row.assignment === "requested" ? row.professionalName : null,
    assignedName: row.professionalName,
    customerName: booking.customerName ?? "",
    customerPhone: booking.customerPhone,
    atClientPlace: booking.atClientPlace,
    addressText: booking.clientAddressText,
    totalPrice: booking.totalPrice,
    currency: booking.currency,
    status: booking.status,
  };
}

/** A reminder is only worth sending for a visit that is still on and still ahead. */
function stillWanted(message: Message, facts: BookingFacts, now: Date) {
  if (message.kind !== "booking_reminder") return true;
  return (facts.status === "confirmed" || facts.status === "arrived") && facts.startsAt > now;
}

async function recipientName(message: Message, facts: BookingFacts) {
  if (!BUSINESS_KINDS.includes(message.kind)) return facts.customerName;
  if (!message.userId) return "";
  const [user] = await db.select({ name: users.displayName }).from(users).where(eq(users.id, message.userId));
  return user?.name ?? "";
}

async function finish(id: string, set: Partial<typeof messages.$inferInsert>, now: Date) {
  await db.update(messages).set({ ...set, updatedAt: now }).where(eq(messages.id, id));
}

/** Queues the same message by email when Telegram can no longer reach the person. */
async function fallBackToEmail(message: Message, now: Date) {
  let recipient: string | null = null;
  if (BUSINESS_KINDS.includes(message.kind)) {
    const [person] = message.userId ? await staffTargets([message.userId]) : [];
    recipient = person?.target.channel === "email" ? person.target.recipient : null;
  } else if (message.bookingId) {
    const [booking] = await db
      .select({ customerRecordId: bookings.customerRecordId, customerEmail: bookings.customerEmail })
      .from(bookings)
      .where(eq(bookings.id, message.bookingId));
    const target = booking ? await customerTarget(booking) : null;
    recipient = target?.channel === "email" ? target.recipient : null;
  }
  if (!recipient) return;
  await db.insert(messages).values({
    businessId: message.businessId,
    bookingId: message.bookingId,
    customerRecordId: message.customerRecordId,
    userId: message.userId,
    kind: message.kind,
    channel: "email",
    recipient,
    linkToken: message.linkToken,
    scheduledFor: now,
  });
}

/** Sends one claimed message, or schedules another try. */
async function deliverOne(message: Message, now: Date) {
  try {
    const facts = message.bookingId ? await loadFacts(message.bookingId) : null;
    if (!facts || !stillWanted(message, facts, now)) {
      await finish(message.id, { status: "cancelled", linkToken: null }, now);
      return;
    }
    const name = await recipientName(message, facts);

    if (message.channel === "telegram") {
      const { text } = composeEmail(message.kind, facts, { email: "", name }, message.linkToken, "telegram");
      const result = await sendTelegramMessage(message.recipient, text);
      if (!result.ok && result.blocked) {
        // She blocked the bot: stop using that chat, and pass this message on by email if we can.
        await markChatBlocked(message.recipient, now);
        await finish(message.id, { status: "failed", error: result.error, linkToken: null }, now);
        await fallBackToEmail(message, now);
        return;
      }
      if (!result.ok) throw new Error(result.error);
      await finish(
        message.id,
        { status: "sent", sentAt: now, linkToken: null, error: null, providerMessageId: result.messageId },
        now,
      );
      return;
    }
    if (message.channel !== "email") throw new Error(`No sender for ${message.channel} yet`);

    const email = composeEmail(message.kind, facts, { email: message.recipient, name }, message.linkToken);
    await sendEmail(email);
    await finish(message.id, { status: "sent", sentAt: now, linkToken: null, error: null }, now);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    const giveUp = message.attempts >= MAX_ATTEMPTS;
    await finish(
      message.id,
      giveUp
        ? { status: "failed", error: text.slice(0, 500), linkToken: null }
        : {
            status: "queued",
            error: text.slice(0, 500),
            scheduledFor: new Date(now.getTime() + retryDelayMs(message.attempts)),
          },
      now,
    );
  }
}

/**
 * Sends everything that is due. Returns how many messages were handled.
 * `businessId` limits a run to one business; tests use it so that test
 * files running side by side, each with its own pretend clock, stay apart.
 */
export async function deliverDueMessages(
  now = new Date(),
  options: { businessId?: string } = {},
): Promise<number> {
  await releaseStuck(now);
  let handled = 0;
  // A few rounds at most, so one run cannot go on forever.
  for (let round = 0; round < 10; round++) {
    const batch = await claimDue(now, options.businessId);
    if (batch.length === 0) break;
    for (const message of batch) await deliverOne(message, now);
    handled += batch.length;
  }
  return handled;
}
