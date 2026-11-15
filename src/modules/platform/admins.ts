import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { platformAdmins, users } from "@/db/schema";
import { env } from "@/env";
import { logActivity } from "@/modules/audit/log";

/** Emails named in PLATFORM_ADMIN_EMAILS, lower-cased. */
export function configuredAdminEmails(raw: string | undefined = env.PLATFORM_ADMIN_EMAILS): string[] {
  return (raw ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * A platform administrator is either granted in the database, or has a
 * verified email named in PLATFORM_ADMIN_EMAILS (how the first admin gets in).
 * An unverified email never counts: anyone can sign up with any address.
 */
export async function isPlatformAdmin(
  userId: string,
  adminEmails: string[] = configuredAdminEmails(),
): Promise<boolean> {
  const [user] = await db
    .select({
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      granted: platformAdmins.userId,
    })
    .from(users)
    .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);
  if (!user || user.status !== "active") return false;
  if (user.granted) return true;
  return Boolean(
    user.email && user.emailVerifiedAt && adminEmails.includes(user.email.toLowerCase()),
  );
}

export type GrantAdminResult =
  | { ok: true }
  | { ok: false; error: "user_not_found" | "already_admin" };

export async function grantPlatformAdmin(
  userId: string,
  grantedByUserId: string | null,
): Promise<GrantAdminResult> {
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "user_not_found" };

  if (await isPlatformAdmin(userId)) return { ok: false, error: "already_admin" };

  await db.insert(platformAdmins).values({
    userId,
    grantedByUserId,
  });

  await logActivity({
    actorUserId: grantedByUserId,
    action: "platform.admin_granted",
    entityType: "platform_admin",
    entityId: userId,
  });

  return { ok: true };
}

export async function revokePlatformAdmin(
  userId: string,
  revokedByUserId: string | null,
): Promise<boolean> {
  const deleted = await db
    .delete(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .returning({ userId: platformAdmins.userId });

  if (deleted.length === 0) return false;

  await logActivity({
    actorUserId: revokedByUserId,
    action: "platform.admin_revoked",
    entityType: "platform_admin",
    entityId: userId,
  });

  return true;
}
