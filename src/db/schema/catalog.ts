import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses, memberships } from "./businesses";

/** Where a service is performed (D50): her place, the customer's place, or either. */
export const serviceLocationTypeEnum = pgEnum("service_location_type", [
  "studio",
  "client_place",
  "both",
]);

export const serviceStatusEnum = pgEnum("service_status", ["active", "archived"]);

/** Something that can be booked (F13). */
export const services = pgTable(
  "services",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    durationMinutes: integer("duration_minutes").notNull(),
    // Time blocked after the service, for cleaning up or resting (D34).
    bufferMinutes: integer("buffer_minutes").notNull().default(0),
    locationType: serviceLocationTypeEnum("location_type").notNull().default("studio"),
    // Santim. Each is set only when the service is offered at that kind of place;
    // the customer's-place price includes any travel fee.
    priceStudio: integer("price_studio"),
    priceClientPlace: integer("price_client_place"),
    currency: text("currency").notNull().default("ETB"),
    // Null follows the business's approval mode (F16).
    requiresApproval: boolean("requires_approval"),
    sortOrder: integer("sort_order").notNull().default(0),
    status: serviceStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("services_business_id_idx").on(table.businessId),
    check("services_duration_positive", sql`${table.durationMinutes} > 0`),
    check("services_buffer_not_negative", sql`${table.bufferMinutes} >= 0`),
    check(
      "services_prices_not_negative",
      sql`coalesce(${table.priceStudio}, 0) >= 0 and coalesce(${table.priceClientPlace}, 0) >= 0`,
    ),
    // A price exists for every kind of place the service is offered at.
    check(
      "services_price_matches_location",
      sql`(${table.locationType} = 'client_place' or ${table.priceStudio} is not null)
        and (${table.locationType} = 'studio' or ${table.priceClientPlace} is not null)`,
    ),
  ],
);

/**
 * Who can perform each service. This list is what "Any available" chooses
 * from (D84). It carries business_id so the scoped data layer guards it.
 */
export const serviceProviders = pgTable(
  "service_providers",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    serviceId: uuid("service_id")
      .notNull()
      .references(() => services.id, { onDelete: "cascade" }),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("service_providers_unique").on(table.serviceId, table.membershipId),
    index("service_providers_membership_id_idx").on(table.membershipId),
    index("service_providers_business_id_idx").on(table.businessId),
  ],
);

export type Service = typeof services.$inferSelect;
export type ServiceProvider = typeof serviceProviders.$inferSelect;
