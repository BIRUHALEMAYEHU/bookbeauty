import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { authIdentities, users } from "@/db/schema";
import { env, telegramEnabled } from "@/env";
import { createSession } from "./session";
import {
  displayNameFromTelegram,
  type TelegramAuthPayload,
  verifyTelegramLogin,
} from "./telegram";

export async function loginWithTelegram(
  payload: TelegramAuthPayload,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<
  { ok: true } | { ok: false; error: "not_configured" | "invalid_payload" | "suspended" }
> {
  if (!telegramEnabled()) return { ok: false, error: "not_configured" };
  if (!verifyTelegramLogin(payload, env.TELEGRAM_BOT_TOKEN!)) {
    return { ok: false, error: "invalid_payload" };
  }

  const providerUserId = String(payload.id);
  const [identity] = await db
    .select()
    .from(authIdentities)
    .where(
      and(
        eq(authIdentities.provider, "telegram"),
        eq(authIdentities.providerUserId, providerUserId),
      ),
    )
    .limit(1);

  let userId: string;

  if (identity) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.id, identity.userId))
      .limit(1);
    if (!user) return { ok: false, error: "invalid_payload" };
    if (user.status !== "active") return { ok: false, error: "suspended" };
    userId = user.id;
  } else {
    const [created] = await db
      .insert(users)
      .values({
        displayName: displayNameFromTelegram(payload),
        email: null,
      })
      .returning({ id: users.id });
    if (!created) return { ok: false, error: "invalid_payload" };
    userId = created.id;
    await db.insert(authIdentities).values({
      userId,
      provider: "telegram",
      providerUserId,
    });
  }

  await createSession(userId, meta);
  return { ok: true };
}
