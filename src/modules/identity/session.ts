import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { cookies, headers } from "next/headers";
import { db } from "@/db/client";
import { sessions, users, type User } from "@/db/schema";
import { hosts } from "@/env";
import { adminIsSeparate, areasForHost } from "@/lib/hosts";
import { generateToken, hashToken } from "@/lib/tokens";
import { isPlatformAdmin } from "@/modules/platform/admins";

/**
 * Where a login is valid (D109). When the admin area has its own address, a
 * login made there is an "admin" session with its own cookie and a short
 * life; logins everywhere else are "app" sessions. Neither is accepted by the
 * other, so a stolen app cookie cannot open the admin area.
 */
export type SessionAudience = "app" | "admin";

const COOKIE: Record<SessionAudience, string> = {
  app: "book_session",
  admin: "book_admin_session",
};
const LIFETIME_MS: Record<SessionAudience, number> = {
  app: 30 * 24 * 60 * 60 * 1000,
  admin: 12 * 60 * 60 * 1000,
};

export const SESSION_COOKIE = COOKIE.app;

/** The audience of the address this request arrived at. */
export async function currentAudience(): Promise<SessionAudience> {
  if (!adminIsSeparate(hosts)) return "app";
  const here = areasForHost((await headers()).get("host"), hosts);
  return here.includes("admin") && !here.includes("app") ? "admin" : "app";
}

/** Whether this address may show the admin area at all. */
export async function adminAreaIsHere(): Promise<boolean> {
  if (!adminIsSeparate(hosts)) return true;
  return areasForHost((await headers()).get("host"), hosts).includes("admin");
}

type Meta = { ipAddress?: string | null; userAgent?: string | null };

export async function createSessionRecord(
  userId: string,
  meta: Meta = {},
  audience: SessionAudience = "app",
) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + LIFETIME_MS[audience]);

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    audience,
    expiresAt,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  return { token, expiresAt };
}

/**
 * Logs the person in at the address she is using. Returns false, creating
 * nothing, when a non-administrator tries to log in at the admin address.
 */
export async function createSession(userId: string, meta: Meta = {}): Promise<boolean> {
  const audience = await currentAudience();
  if (audience === "admin" && !(await isPlatformAdmin(userId))) return false;

  const { token, expiresAt } = await createSessionRecord(userId, meta, audience);

  const cookieStore = await cookies();
  cookieStore.set(COOKIE[audience], token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // "lax", not "strict": the browser must send it on the way back from Google.
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return true;
}

export async function destroySession() {
  const audience = await currentAudience();
  const cookieStore = await cookies();
  const token = cookieStore.get(COOKIE[audience])?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  cookieStore.delete(COOKIE[audience]);
}

/** The active user behind a session token, if it is valid for this audience. */
export async function findSessionUser(
  token: string,
  audience: SessionAudience,
): Promise<User | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        eq(sessions.audience, audience),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .limit(1);

  if (!row || row.user.status !== "active") return null;
  return row.user;
}

export async function getSessionUser(): Promise<User | null> {
  const audience = await currentAudience();
  const token = (await cookies()).get(COOKIE[audience])?.value;
  if (!token) return null;
  return findSessionUser(token, audience);
}

export function hashSessionTokenForTests(token: string) {
  return hashToken(token);
}
