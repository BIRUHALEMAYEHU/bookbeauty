import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { platformAdmins, users } from "@/db/schema";
import { logActivity } from "@/modules/audit/log";

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ userId: platformAdmins.userId })
    .from(platformAdmins)
    .where(eq(platformAdmins.userId, userId))
    .limit(1);
  return Boolean(row);
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
