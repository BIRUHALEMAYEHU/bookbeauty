import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { rateLimitBuckets } from "@/db/schema";

export type RateLimitResult =
  | { ok: true; remaining: number }
  | { ok: false; retryAfterSeconds: number };

export type RateLimitPolicy = {
  /** Logical bucket, for example "signup:ip:1.2.3.4". */
  key: string;
  /** Max successful consumes in one window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
};

function windowStart(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

/**
 * Atomically increments the bucket and returns whether the caller may proceed.
 * Uses INSERT … ON CONFLICT to stay correct under concurrent requests.
 */
export async function consumeRateLimit(
  policy: RateLimitPolicy,
  now: Date = new Date(),
): Promise<RateLimitResult> {
  const start = windowStart(now, policy.windowSeconds);

  const [row] = await db
    .insert(rateLimitBuckets)
    .values({
      key: policy.key,
      windowStart: start,
      count: 1,
    })
    .onConflictDoUpdate({
      target: [rateLimitBuckets.key, rateLimitBuckets.windowStart],
      set: {
        count: sql`${rateLimitBuckets.count} + 1`,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimitBuckets.count });

  const count = row?.count ?? 1;
  if (count > policy.limit) {
    const retryAfterSeconds = Math.max(
      1,
      policy.windowSeconds - Math.floor((now.getTime() - start.getTime()) / 1000),
    );
    return { ok: false, retryAfterSeconds };
  }

  return { ok: true, remaining: Math.max(0, policy.limit - count) };
}

export const RATE_LIMITS = {
  signupIp: (ip: string) => ({
    key: `signup:ip:${ip || "unknown"}`,
    limit: 10,
    windowSeconds: 60 * 60,
  }),
  loginIp: (ip: string) => ({
    key: `login:ip:${ip || "unknown"}`,
    limit: 30,
    windowSeconds: 15 * 60,
  }),
  loginEmail: (email: string) => ({
    key: `login:email:${email.toLowerCase()}`,
    limit: 10,
    windowSeconds: 15 * 60,
  }),
} as const satisfies Record<string, (id: string) => RateLimitPolicy>;
