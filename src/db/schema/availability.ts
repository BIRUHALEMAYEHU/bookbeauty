import { sql } from "drizzle-orm";
import {
  check,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses, locations, memberships } from "./businesses";

/**
 * A professional's weekly shifts (F14). Several rows on one weekday make a
 * split shift (a lunch break). Times are minutes after midnight on the
 * location's own clock, so "9:00 AM" is 540 whatever the server's time zone.
 */
export const workingHours = pgTable(
  "working_hours",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    // 0 is Sunday, 6 is Saturday.
    weekday: smallint("weekday").notNull(),
    startMinute: smallint("start_minute").notNull(),
    endMinute: smallint("end_minute").notNull(),
  },
  (table) => [
    index("working_hours_membership_id_idx").on(table.membershipId),
    index("working_hours_business_id_idx").on(table.businessId),
    check("working_hours_weekday_range", sql`${table.weekday} between 0 and 6`),
    check(
      "working_hours_minutes_range",
      sql`${table.startMinute} >= 0 and ${table.endMinute} <= 1440 and ${table.startMinute} < ${table.endMinute}`,
    ),
  ],
);

export const availabilityExceptionKindEnum = pgEnum("availability_exception_kind", [
  "time_off",
  "extra_hours",
]);

/** One-off changes to a professional's week: time off, or extra hours on a day she is usually off. */
export const availabilityExceptions = pgTable(
  "availability_exceptions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    kind: availabilityExceptionKindEnum("kind").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("availability_exceptions_membership_idx").on(table.membershipId, table.endsAt),
    index("availability_exceptions_business_id_idx").on(table.businessId),
    check("availability_exceptions_order", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

/** Days the whole place is closed (holidays), separate from anyone's personal calendar (Section 15.5). */
export const locationClosures = pgTable(
  "location_closures",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("location_closures_location_idx").on(table.locationId, table.endsAt),
    index("location_closures_business_id_idx").on(table.businessId),
    check("location_closures_order", sql`${table.startsAt} < ${table.endsAt}`),
  ],
);

export type WorkingHoursRow = typeof workingHours.$inferSelect;
export type AvailabilityException = typeof availabilityExceptions.$inferSelect;
export type LocationClosure = typeof locationClosures.$inferSelect;
