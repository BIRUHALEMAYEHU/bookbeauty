import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { businesses } from "./businesses";
import { users } from "./identity";

/**
 * Append-only activity log (D60). Never update or delete rows from application code.
 */
export const activityLog = pgTable(
  "activity_log",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    businessId: uuid("business_id").references(() => businesses.id),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    before: jsonb("before").$type<Record<string, unknown> | null>(),
    after: jsonb("after").$type<Record<string, unknown> | null>(),
    ipAddress: text("ip_address"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    index("activity_log_business_id_created_at_idx").on(
      table.businessId,
      table.createdAt,
    ),
    index("activity_log_actor_user_id_idx").on(table.actorUserId),
  ],
);

export type ActivityLogEntry = typeof activityLog.$inferSelect;
