import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { env } from "@/env";
import { sendEmail } from "@/integrations/email";
import { consumeRateLimit, RATE_LIMITS } from "@/modules/abuse/rate-limit";
import { consumeEmailToken, issueEmailToken } from "./email-tokens";
import { linkEmail } from "./emails";

export type SendVerificationResult =
  | { ok: true }
  | { ok: false; error: "no_email" | "already_verified" | "rate_limited" };

/** Emails a "confirm your email" link to the account's current address. */
export async function sendVerificationEmail(userId: string): Promise<SendVerificationResult> {
  const [user] = await db
    .select({
      email: users.email,
      displayName: users.displayName,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user?.email) return { ok: false, error: "no_email" };
  if (user.emailVerifiedAt) return { ok: false, error: "already_verified" };

  const limited = await consumeRateLimit(RATE_LIMITS.verificationEmailUser(userId));
  if (!limited.ok) return { ok: false, error: "rate_limited" };

  const token = await issueEmailToken(userId, "verify_email", user.email);
  const url = `${env.APP_URL}/api/auth/verify-email?token=${token}`;
  await sendEmail(linkEmail("verify", { email: user.email, name: user.displayName }, url));
  return { ok: true };
}

/**
 * Marks the email verified if the link is valid and was sent to the address
 * the account still has.
 */
export async function verifyEmail(
  rawToken: string,
): Promise<{ ok: true; userId: string } | { ok: false }> {
  const token = await consumeEmailToken(rawToken, "verify_email");
  if (!token) return { ok: false };

  const now = new Date();
  const [updated] = await db
    .update(users)
    .set({ emailVerifiedAt: now, updatedAt: now })
    .where(
      and(
        eq(users.id, token.userId),
        eq(users.email, token.email),
        isNull(users.emailVerifiedAt),
      ),
    )
    .returning({ id: users.id });

  if (updated) return { ok: true, userId: updated.id };

  // Already verified (a second click) still counts as success; a changed email does not.
  const [user] = await db
    .select({ email: users.email, emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, token.userId))
    .limit(1);
  if (user?.email === token.email && user.emailVerifiedAt) {
    return { ok: true, userId: token.userId };
  }
  return { ok: false };
}
