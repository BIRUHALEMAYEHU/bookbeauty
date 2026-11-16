import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
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

/**
 * People who started a chat with the bot (D89: a bot can only message those
 * who did). For a private chat Telegram's chat id is the person's user id.
 * Not business data: one chat can be linked to several businesses.
 */
export const telegramChats = pgTable(
  "telegram_chats",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    chatId: text("chat_id").notNull(),
    telegramUserId: text("telegram_user_id"),
    // Set for professionals who log in with Telegram.
    userId: uuid("user_id").references(() => users.id),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    // When Telegram said she blocked the bot; nothing is sent there after that.
    blockedAt: timestamp("blocked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [uniqueIndex("telegram_chats_chat_id_unique").on(table.chatId)],
);

/** A customer's chat, linked to her record at one business when she tapped "Get reminders on Telegram". */
export const telegramLinks = pgTable(
  "telegram_links",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    telegramChatId: uuid("telegram_chat_id")
      .notNull()
      .references(() => telegramChats.id, { onDelete: "cascade" }),
    customerRecordId: uuid("customer_record_id")
      .notNull()
      .references(() => customerRecords.id, { onDelete: "cascade" }),
    // The booking she linked from: her booking page says "on Telegram" only for this one (D91).
    bookingId: uuid("booking_id").references(() => bookings.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    unlinkedAt: timestamp("unlinked_at", { withTimezone: true, mode: "date" }),
  },
  (table) => [
    index("telegram_links_customer_record_id_idx").on(table.customerRecordId),
    index("telegram_links_business_id_idx").on(table.businessId),
  ],
);

/**
 * The one-time code in the bot link (t.me/<bot>?start=<code>), stored only
 * as a hash. It says which booking, and so which customer record, to link.
 */
export const telegramLinkCodes = pgTable(
  "telegram_link_codes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("telegram_link_codes_code_hash_unique").on(table.codeHash),
    index("telegram_link_codes_business_id_idx").on(table.businessId),
  ],
);

export type Message = typeof messages.$inferSelect;
export type TelegramChat = typeof telegramChats.$inferSelect;
export type MessageKind = (typeof messageKindEnum.enumValues)[number];
