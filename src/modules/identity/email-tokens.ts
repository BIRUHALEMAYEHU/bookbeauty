import "server-only";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { emailTokens } from "@/db/schema";
import { generateToken, hashToken } from "@/lib/tokens";

export type EmailTokenPurpose = "verify_email" | "reset_password";

const LIFETIME_MS: Record<EmailTokenPurpose, number> = {
  verify_email: 24 * 60 * 60 * 1000,
  reset_password: 60 * 60 * 1000,
};

/** Creates a one-time link token and returns the raw value for the link. */
export async function issueEmailToken(
  userId: string,
  purpose: EmailTokenPurpose,
  email: string,
): Promise<string> {
  const token = generateToken();
  await db.insert(emailTokens).values({
    userId,
    purpose,
    email,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + LIFETIME_MS[purpose]),
  });
  return token;
}

function usable(rawToken: string, purpose: EmailTokenPurpose) {
  return and(
    eq(emailTokens.tokenHash, hashToken(rawToken)),
    eq(emailTokens.purpose, purpose),
    isNull(emailTokens.usedAt),
    gt(emailTokens.expiresAt, new Date()),
  );
}

/** Whether a link still works, without using it up (for showing the reset form). */
export async function isEmailTokenUsable(
  rawToken: string,
  purpose: EmailTokenPurpose,
): Promise<boolean> {
  if (!rawToken) return false;
  const [row] = await db
    .select({ id: emailTokens.id })
    .from(emailTokens)
    .where(usable(rawToken, purpose))
    .limit(1);
  return Boolean(row);
}

/**
 * Uses up a link token. A single UPDATE marks it used, so two simultaneous
 * clicks cannot both succeed. Returns null for unknown, used or expired tokens.
 */
export async function consumeEmailToken(
  rawToken: string,
  purpose: EmailTokenPurpose,
): Promise<{ userId: string; email: string } | null> {
  if (!rawToken) return null;
  const [row] = await db
    .update(emailTokens)
    .set({ usedAt: new Date() })
    .where(usable(rawToken, purpose))
    .returning({ userId: emailTokens.userId, email: emailTokens.email });
  return row ?? null;
}
