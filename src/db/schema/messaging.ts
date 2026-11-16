import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bookings, customerRecords } from "./booking";
import { businesses } from "./businesses";
import { users } from "./identity";

export const messageKindEnum = pgEnum("message_kind", [
  // To the customer.
  "booking_confirmation",
  "booking_request_received",
  "booking_approved",
  "booking_declined",
  "booking_cancelled_by_business",
  "booking_reminder",
  // To the business.
  "new_booking_notice",
  "booking_cancelled_notice",
]);

export const messageChannelEnum = pgEnum("message_channel", ["email", "telegram", "sms"]);

export const messageStatusEnum = pgEnum("message_status", [
  "queued",
  // Claimed by a worker; put back to queued if the worker stops mid-send.
  "sending",
  "sent",
  "failed",
  // No longer needed, for example a reminder for a booking that was cancelled.
  "cancelled",
  // Over the plan's SMS allowance (F27).
  "skipped_limit",
]);

/**
 * Every message the platform sends (playbook Chapter 16), and also its
 * outbox: a row is written first, and a background job sends it when it is
 * due, retrying failures. One function writes these rows (technical-plan
 * Section 8), so nothing sends messages any other way.
 */
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    kind: messageKindEnum("kind").notNull(),
    channel: messageChannelEnum("channel").notNull(),
    // An email address, Telegram chat id or phone number.
    recipient: text("recipient").notNull(),
    customerRecordId: uuid("customer_record_id").references(() => customerRecords.id, {
      onDelete: "set null",
    }),
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id),
    status: messageStatusEnum("status").notNull().default("queued"),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    attempts: integer("attempts").notNull().default(0),
    // The customer's private booking link, needed only for the first email
    // about a booking. Links are otherwise stored only as hashes, so this is
    // wiped as soon as the message is sent or given up on.
    linkToken: text("link_token"),
    sentAt: timestamp("sent_at", { withTimezone: true, mode: "date" }),
    // SMS segments; 0 for free channels.
    costUnits: integer("cost_units").notNull().default(0),
    providerMessageId: text("provider_message_id"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // What the sender looks for: queued messages that are due.
    index("messages_due_idx")
      .on(table.scheduledFor)
      .where(sql`${table.status} = 'queued'`),
    index("messages_booking_id_idx").on(table.bookingId),
    index("messages_business_created_idx").on(table.businessId, table.createdAt),
  ],
);

export type Message = typeof messages.$inferSelect;
export type MessageKind = (typeof messageKindEnum.enumValues)[number];
