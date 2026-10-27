import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { authIdentities, users } from "@/db/schema";
import { consumeRateLimit, RATE_LIMITS } from "@/modules/abuse/rate-limit";
import { hashPassword, verifyPassword } from "./password";
import { createSession } from "./session";

export const signupSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z
    .string()
    .min(8)
    .max(200)
    .regex(/[A-Za-z]/, "Password must include a letter")
    .regex(/[0-9]/, "Password must include a number"),
});

export const loginSchema = z.object({
  email: z.string().trim().email().max(254).transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(200),
});

export type AuthResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "invalid_input"
        | "email_taken"
        | "invalid_credentials"
        | "suspended"
        | "rate_limited";
    };

export async function signupWithEmail(
  input: z.infer<typeof signupSchema>,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<AuthResult> {
  const parsed = signupSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const limited = await consumeRateLimit(RATE_LIMITS.signupIp(meta.ipAddress ?? ""));
  if (!limited.ok) return { ok: false, error: "rate_limited" };

  const { displayName, email, password } = parsed.data;
  const passwordHash = await hashPassword(password);

  try {
    const [user] = await db
      .insert(users)
      .values({ displayName, email, passwordHash })
      .returning({ id: users.id });

    if (!user) return { ok: false, error: "invalid_input" };

    await db.insert(authIdentities).values({
      userId: user.id,
      provider: "email",
      providerUserId: email,
    });

    await createSession(user.id, meta);
    return { ok: true };
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: "email_taken" };
    throw error;
  }
}

export async function loginWithEmail(
  input: z.infer<typeof loginSchema>,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<AuthResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_credentials" };

  const { email, password } = parsed.data;

  const ipLimit = await consumeRateLimit(RATE_LIMITS.loginIp(meta.ipAddress ?? ""));
  if (!ipLimit.ok) return { ok: false, error: "rate_limited" };
  const emailLimit = await consumeRateLimit(RATE_LIMITS.loginEmail(email));
  if (!emailLimit.ok) return { ok: false, error: "rate_limited" };

  const [user] = await db
    .select()
    .from(users)
    .where(and(eq(users.email, email)))
    .limit(1);

  if (!user?.passwordHash) return { ok: false, error: "invalid_credentials" };
  if (user.status !== "active") return { ok: false, error: "suspended" };

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) return { ok: false, error: "invalid_credentials" };

  await createSession(user.id, meta);
  return { ok: true };
}

function isUniqueViolation(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current; depth++) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      (current as { code: string }).code === "23505"
    ) {
      return true;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? (current as { cause: unknown }).cause
        : null;
  }
  return false;
}

