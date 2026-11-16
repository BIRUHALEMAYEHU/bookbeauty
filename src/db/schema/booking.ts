import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { businesses, locations, memberships } from "./businesses";
import { services } from "./catalog";
import { users } from "./identity";

/**
 * What a business knows about one customer (Section 9.2). Created by her
 * first booking; owned by the business (D38).
 */
export const customerRecords = pgTable(
  "customer_records",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    // E.164. The matching key (D29, D92); not proof of identity (D91).
    phone: text("phone").notNull(),
    email: text("email"),
    // Never asked on the booking form (D21, D67).
    dateOfBirth: date("date_of_birth"),
    // Safety information: shown to every professional who serves her (D43).
    allergies: text("allergies"),
    customerNotes: text("customer_notes"),
    marketingOptOutAt: timestamp("marketing_opt_out_at", { withTimezone: true, mode: "date" }),
    // For fixing wrong matches (D92).
    mergedIntoId: uuid("merged_into_id").references((): AnyPgColumn => customerRecords.id),
    splitFromId: uuid("split_from_id").references((): AnyPgColumn => customerRecords.id),
    // Cached totals, recalculated from bookings.
    visitCount: integer("visit_count").notNull().default(0),
    totalSpent: integer("total_spent").notNull().default(0),
    lastVisitAt: timestamp("last_visit_at", { withTimezone: true, mode: "date" }),
    noShowCount: integer("no_show_count").notNull().default(0),
    cancellationCount: integer("cancellation_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Not unique: after a split (a shared phone), two records can have one number.
    index("customer_records_business_phone_idx").on(table.businessId, table.phone),
  ],
);

/**
 * Notes staff write about a customer (F24): preferences, what was used last
 * time. Allergies never go here; they live on the record, where everyone
 * serving her sees them (D43). Private notes (author and owner only) come in
 * Layer 2; until then every note is shared with the team.
 * Carries business_id so the scoped data layer guards it.
 */
export const staffNotes = pgTable(
  "staff_notes",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    customerRecordId: uuid("customer_record_id")
      .notNull()
      .references(() => customerRecords.id, { onDelete: "cascade" }),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id),
    body: text("body").notNull(),
    isPrivate: boolean("is_private").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("staff_notes_customer_record_id_idx").on(table.customerRecordId),
    index("staff_notes_business_id_idx").on(table.businessId),
  ],
);

export const bookingStatusEnum = pgEnum("booking_status", [
  // The slot is reserved while the customer fills in the form. Never shown.
  "held",
  "pending_approval",
  // Layer 4, parked (D73).
  "awaiting_deposit",
  "confirmed",
  "arrived",
  "completed",
  "cancelled",
  "no_show",
  // A hold never finished, or a request never approved.
  "expired",
]);

export const bookingSourceEnum = pgEnum("booking_source", [
  "business_page",
  "professional_page",
  "staff",
]);

export const cancelledByEnum = pgEnum("cancelled_by", ["customer", "business", "system"]);

/** A visit: one customer, one time, one or (from Layer 2) several services. */
export const bookings = pgTable(
  "bookings",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id),
    // Empty only while the booking is held, before she has given her details.
    customerRecordId: uuid("customer_record_id").references(() => customerRecords.id),
    status: bookingStatusEnum("status").notNull(),
    source: bookingSourceEnum("source").notNull(),
    // What she typed when booking. The record matched by phone may carry
    // another name (a shared phone), so these are kept with the booking.
    customerName: text("customer_name"),
    customerPhone: text("customer_phone"),
    customerEmail: text("customer_email"),
    atClientPlace: boolean("at_client_place").notNull().default(false),
    // Free text is required for a visit to her place; the pin is optional (D51).
    clientAddressText: text("client_address_text"),
    clientLatitude: doublePrecision("client_latitude"),
    clientLongitude: doublePrecision("client_longitude"),
    customerNotes: text("customer_notes"),
    totalPrice: integer("total_price").notNull(),
    currency: text("currency").notNull().default("ETB"),
    // Recorded when the visit is marked complete (D59).
    amountPaid: integer("amount_paid"),
    paymentMethod: text("payment_method"),
    holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true, mode: "date" }),
    approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }),
    approvedByUserId: uuid("approved_by_user_id").references(() => users.id),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedByUserId: uuid("completed_by_user_id").references(() => users.id),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }),
    cancelledBy: cancelledByEnum("cancelled_by"),
    cancelReason: text("cancel_reason"),
    // Lets a guest see or cancel her booking from a link, with no account.
    manageTokenHash: text("manage_token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("bookings_manage_token_hash_unique").on(table.manageTokenHash),
    index("bookings_business_status_idx").on(table.businessId, table.status),
    index("bookings_customer_record_id_idx").on(table.customerRecordId),
    index("bookings_held_expiry_idx")
      .on(table.holdExpiresAt)
      .where(sql`${table.status} = 'held'`),
    check("bookings_total_not_negative", sql`${table.totalPrice} >= 0`),
  ],
);

export const appointmentAssignmentEnum = pgEnum("appointment_assignment", [
  // The customer chose her.
  "requested",
  // The system picked her for "Any available" (D98).
  "auto",
  // Staff assigned her.
  "manual",
]);

export const appointmentStatusEnum = pgEnum("appointment_status", ["active", "cancelled"]);

/**
 * One service within a visit, performed by one professional.
 *
 * The rule against double-booking is an exclusion constraint on this table,
 * added in a hand-written migration because Drizzle cannot express it: no
 * two active appointments for the same professional_user_id may overlap in
 * [starts_at, blocked_until). It uses the person, not the membership, so it
 * also holds across every business she works at.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    bookingId: uuid("booking_id")
      .notNull()
      .references(() => bookings.id, { onDelete: "cascade" }),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id),
    // Empty only for Layer 2's "assign at arrival".
    membershipId: uuid("membership_id").references(() => memberships.id),
    // The same person as a user id, so one rule blocks her time everywhere.
    professionalUserId: uuid("professional_user_id").references(() => users.id),
    assignment: appointmentAssignmentEnum("assignment").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    // ends_at plus the free time after, plus travel time for a visit to her place.
    blockedUntil: timestamp("blocked_until", { withTimezone: true, mode: "date" }).notNull(),
    price: integer("price").notNull(),
    currency: text("currency").notNull().default("ETB"),
    status: appointmentStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("appointments_booking_id_idx").on(table.bookingId),
    index("appointments_business_starts_idx").on(table.businessId, table.startsAt),
    index("appointments_professional_starts_idx").on(table.professionalUserId, table.startsAt),
    check(
      "appointments_times_in_order",
      sql`${table.startsAt} < ${table.endsAt} and ${table.endsAt} <= ${table.blockedUntil}`,
    ),
  ],
);

export type CustomerRecord = typeof customerRecords.$inferSelect;
export type StaffNote = typeof staffNotes.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
