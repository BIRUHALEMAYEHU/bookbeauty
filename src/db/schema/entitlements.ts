import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./businesses";
import { users } from "./identity";

export const planAudienceEnum = pgEnum("plan_audience", ["independent", "salon"]);

export const billingPeriodEnum = pgEnum("billing_period", ["monthly", "yearly"]);

export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "free",
  "active",
  "lapsed",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "telebirr",
  "bank_transfer",
  "cash",
  "other",
]);

export const plans = pgTable("plans", {
  key: text("key").primaryKey(),
  name: text("name").notNull(),
  audience: planAudienceEnum("audience").notNull(),
  /** Price in minor units (santim). Zero for free plans. */
  price: integer("price").notNull().default(0),
  currency: text("currency").notNull().default("ETB"),
  billingPeriod: billingPeriodEnum("billing_period"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`),
});

export const planEntitlements = pgTable(
  "plan_entitlements",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    planKey: text("plan_key")
      .notNull()
      .references(() => plans.key),
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    limitValue: integer("limit_value"),
  },
  (table) => [
    uniqueIndex("plan_entitlements_plan_feature_unique").on(
      table.planKey,
      table.featureKey,
    ),
  ],
);

export const entitlementOverrides = pgTable(
  "entitlement_overrides",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    featureKey: text("feature_key").notNull(),
    enabled: boolean("enabled").notNull(),
    limitValue: integer("limit_value"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("entitlement_overrides_business_feature_unique").on(
      table.businessId,
      table.featureKey,
    ),
    index("entitlement_overrides_business_id_idx").on(table.businessId),
  ],
);

export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    planKey: text("plan_key")
      .notNull()
      .references(() => plans.key),
    status: subscriptionStatusEnum("status").notNull().default("free"),
    currentPeriodStart: timestamp("current_period_start", {
      withTimezone: true,
      mode: "date",
    }),
    currentPeriodEnd: timestamp("current_period_end", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("subscriptions_business_id_unique").on(table.businessId),
    index("subscriptions_plan_key_idx").on(table.planKey),
  ],
);

export const subscriptionPayments = pgTable(
  "subscription_payments",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id")
      .notNull()
      .references(() => businesses.id, { onDelete: "cascade" }),
    /** Amount in minor units (santim). */
    amount: integer("amount").notNull(),
    currency: text("currency").notNull().default("ETB"),
    method: paymentMethodEnum("method").notNull(),
    reference: text("reference"),
    recordedByUserId: uuid("recorded_by_user_id")
      .notNull()
      .references(() => users.id),
    recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    periodCovered: text("period_covered"),
  },
  (table) => [index("subscription_payments_business_id_idx").on(table.businessId)],
);

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
