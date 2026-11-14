import "server-only";
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { authIdentities, emailTokens, sessions, users } from "@/db/schema";
import { env } from "@/env";
import { sendEmail } from "@/integrations/email";
import { consumeRateLimit, RATE_LIMITS } from "@/modules/abuse/rate-limit";
import { consumeEmailToken, issueEmailToken } from "./email-tokens";
import { linkEmail } from "./emails";
import { hashPassword, passwordSchema } from "./password";

const emailSchema = z.string().trim().email().max(254).transform((v) => v.toLowerCase());

export type RequestResetResult = { ok: true } | { ok: false; error: "rate_limited" };

/**
 * Sends a reset link if an active account has this email. The answer is the
 * same either way, so the form cannot be used to find out who has an account.
 */
export async function requestPasswordReset(
  rawEmail: string,
  meta: { ipAddress?: string | null } = {},
): Promise<RequestResetResult> {
  const ipLimit = await consumeRateLimit(RATE_LIMITS.passwordResetIp(meta.ipAddress ?? ""));
  if (!ipLimit.ok) return { ok: false, error: "rate_limited" };

  const parsed = emailSchema.safeParse(rawEmail);
  if (!parsed.success) return { ok: true };
  const email = parsed.data;

  const emailLimit = await consumeRateLimit(RATE_LIMITS.passwordResetEmail(email));
  if (!emailLimit.ok) return { ok: false, error: "rate_limited" };

  const [user] = await db
    .select({ id: users.id, displayName: users.displayName, status: users.status })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user || user.status !== "active") return { ok: true };

  const token = await issueEmailToken(user.id, "reset_password", email);
  const url = `${env.APP_URL}/reset-password?token=${token}`;
  await sendEmail(linkEmail("reset", { email, name: user.displayName }, url));
  return { ok: true };
}

export type ResetPasswordResult =
  | { ok: true; userId: string }
  | { ok: false; error: "invalid_password" | "link_invalid" };

/**
 * Sets a new password from a reset link. Opening the link proves she owns the
 * email, so the email becomes verified, and every existing session is ended in
 * case someone else had access. The caller starts a fresh session.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string,
): Promise<ResetPasswordResult> {
  if (!passwordSchema.safeParse(newPassword).success) {
    return { ok: false, error: "invalid_password" };
  }

  const token = await consumeEmailToken(rawToken, "reset_password");
  if (!token) return { ok: false, error: "link_invalid" };

  const passwordHash = await hashPassword(newPassword);

  return db.transaction(async (tx) => {
    const now = new Date();
    const [user] = await tx
      .update(users)
      .set({
        passwordHash,
        emailVerifiedAt: sql`coalesce(${users.emailVerifiedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
      })
      .where(
        and(
          eq(users.id, token.userId),
          eq(users.email, token.email),
          eq(users.status, "active"),
        ),
      )
      .returning({ id: users.id });
    if (!user) return { ok: false as const, error: "link_invalid" as const };

    await tx.delete(sessions).where(eq(sessions.userId, user.id));

    // A Google or Telegram account that had no password now has one.
    await tx
      .insert(authIdentities)
      .values({ userId: user.id, provider: "email", providerUserId: token.email })
      .onConflictDoNothing();

    // Any other reset links for this account stop working.
    await tx
      .update(emailTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailTokens.userId, user.id),
          eq(emailTokens.purpose, "reset_password"),
          isNull(emailTokens.usedAt),
        ),
      );

    return { ok: true as const, userId: user.id };
  });
}
