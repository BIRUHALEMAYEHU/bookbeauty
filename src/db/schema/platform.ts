import { sql } from "drizzle-orm";
import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./identity";

/** Platform admins are separate from business memberships. */
export const platformAdmins = pgTable("platform_admins", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" })
    .notNull()
    .default(sql`now()`),
  grantedByUserId: uuid("granted_by_user_id").references(() => users.id),
});
