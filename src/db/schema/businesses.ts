import { sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./identity";
import { citext } from "./types";

export const businessKindEnum = pgEnum("business_kind", ["independent", "salon"]);

export const businessCategoryEnum = pgEnum("business_category", [
  "hair",
  "barber",
  "nails",
  "makeup",
  "lashes",
  "spa",
  "other",
]);

export const businessStatusEnum = pgEnum("business_status", ["active", "archived"]);

export const approvalModeEnum = pgEnum("approval_mode", ["auto", "manual"]);

export const locationStatusEnum = pgEnum("location_status", ["active", "archived"]);

export const membershipRoleEnum = pgEnum("membership_role", [
  "owner",
  "branch_manager",
  "receptionist",
  "stylist",
]);

export const membershipStatusEnum = pgEnum("membership_status", [
  "invited",
  "requested",
  "active",
  "notice",
  "ended",
]);

export const membershipEndReasonEnum = pgEnum("membership_end_reason", [
  "resigned",
  "removed",
]);

export const businesses = pgTable(
  "businesses",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    kind: businessKindEnum("kind").notNull(),
    name: text("name").notNull(),
    // Required for salons; null for independents (served at the owner's @handle).
    slug: citext("slug"),
    category: businessCategoryEnum("category").notNull(),
    ownerUserId: uuid("owner_user_id")
      .notNull()
      .references(() => users.id),
    about: text("about"),
    phone: text("phone"),
    // Media table arrives in Layer 1; store the id without a foreign key for now.
    logoMediaId: uuid("logo_media_id"),
    timeZone: text("time_zone").notNull().default("Africa/Addis_Ababa"),
    approvalMode: approvalModeEnum("approval_mode").notNull().default("auto"),
    minNoticeMinutes: integer("min_notice_minutes").notNull().default(120),
    maxAdvanceDays: integer("max_advance_days").notNull().default(60),
    noticePeriodDays: integer("notice_period_days").notNull().default(14),
    exclusiveStaff: boolean("exclusive_staff").notNull().default(false),
    status: businessStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("businesses_slug_unique")
      .on(table.slug)
      .where(sql`${table.slug} is not null`),
    // A person may own at most one active independent practice (D96).
    uniqueIndex("businesses_one_independent_per_owner")
      .on(table.ownerUserId)
      .where(sql`${table.kind} = 'independent' and ${table.status} = 'active'`),
    index("businesses_owner_user_id_idx").on(table.ownerUserId),
  ],
);

export const locations = pgTable(
  "locations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: citext("slug").notNull(),
    addressText: text("address_text"),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    addressPublic: boolean("address_public").notNull().default(true),
    isDefault: boolean("is_default").notNull().default(false),
    status: locationStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("locations_business_slug_unique").on(table.businessId, table.slug),
    // Exactly one default location per business.
    uniqueIndex("locations_one_default_per_business")
      .on(table.businessId)
      .where(sql`${table.isDefault} = true`),
    index("locations_business_id_idx").on(table.businessId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    role: membershipRoleEnum("role").notNull(),
    status: membershipStatusEnum("status").notNull().default("active"),
    startedAt: timestamp("started_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    lastDay: timestamp("last_day", { withTimezone: true, mode: "date" }),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    endReason: membershipEndReasonEnum("end_reason"),
    travelBufferMinutes: integer("travel_buffer_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Only one non-ended membership per person per business.
    uniqueIndex("memberships_one_open_per_user_business")
      .on(table.businessId, table.userId)
      .where(sql`${table.status} <> 'ended'`),
    index("memberships_user_id_idx").on(table.userId),
    index("memberships_business_id_idx").on(table.businessId),
  ],
);

export const membershipLocations = pgTable(
  "membership_locations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    membershipId: uuid("membership_id")
      .notNull()
      .references(() => memberships.id, { onDelete: "cascade" }),
    locationId: uuid("location_id")
      .notNull()
      .references(() => locations.id, { onDelete: "cascade" }),
  },
  (table) => [
    uniqueIndex("membership_locations_unique").on(
      table.membershipId,
      table.locationId,
    ),
    index("membership_locations_location_id_idx").on(table.locationId),
  ],
);

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    locationIds: uuid("location_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    invitedContact: text("invited_contact"),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    acceptedByUserId: uuid("accepted_by_user_id").references(() => users.id),
    acceptedAt: timestamp("accepted_at", { withTimezone: true, mode: "date" }),
    createdByUserId: uuid("created_by_user_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_business_id_idx").on(table.businessId),
  ],
);

export type Business = typeof businesses.$inferSelect;
export type Location = typeof locations.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
