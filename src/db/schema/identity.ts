import { sql } from "drizzle-orm";
import {
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { citext } from "./types";

export const userStatusEnum = pgEnum("user_status", ["active", "suspended"]);

export const authProviderEnum = pgEnum("auth_provider", [
  "email",
  "google",
  "telegram",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    displayName: text("display_name").notNull(),
    email: citext("email"),
    emailVerifiedAt: timestamp("email_verified_at", {
      withTimezone: true,
      mode: "date",
    }),
    passwordHash: text("password_hash"),
    phone: text("phone"),
    status: userStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    // Several Telegram-only users may have a null email; non-null emails must be unique.
    uniqueIndex("users_email_unique")
      .on(table.email)
      .where(sql`${table.email} is not null`),
  ],
);

export const authIdentities = pgTable(
  "auth_identities",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: authProviderEnum("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("auth_identities_provider_user_unique").on(
      table.provider,
      table.providerUserId,
    ),
    index("auth_identities_user_id_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // SHA-256 of the cookie token. The raw token never lives in the database.
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_id_idx").on(table.userId),
    index("sessions_expires_at_idx").on(table.expiresAt),
  ],
);

/** Public identity of someone who serves customers. Optional for owners/receptionists. */
export const professionalProfiles = pgTable(
  "professional_profiles",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    handle: citext("handle").notNull(),
    displayName: text("display_name").notNull(),
    bio: text("bio"),
    // Media table arrives in Layer 1; store the id without a foreign key for now.
    avatarMediaId: uuid("avatar_media_id"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("professional_profiles_user_id_unique").on(table.userId),
    uniqueIndex("professional_profiles_handle_unique").on(table.handle),
  ],
);

export const emailTokenPurposeEnum = pgEnum("email_token_purpose", [
  "verify_email",
  "reset_password",
]);

/**
 * One-time links sent by email. Only the SHA-256 of the token is stored; the
 * raw token exists only in the link. `email` is the address the link was sent
 * to, so a link stops working if the account's email changes.
 */
export const emailTokens = pgTable(
  "email_tokens",
  {
    id: uuid("id").primaryKey().default(sql`uuidv7()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: emailTokenPurposeEnum("purpose").notNull(),
    email: citext("email").notNull(),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .default(sql`now()`),
  },
  (table) => [
    uniqueIndex("email_tokens_token_hash_unique").on(table.tokenHash),
    index("email_tokens_user_id_idx").on(table.userId),
  ],
);

export type User = typeof users.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type ProfessionalProfile = typeof professionalProfiles.$inferSelect;
