import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authIdentities, sessions, users } from "@/db/schema";
import { hashPassword } from "./password";
import { createSessionRecord, findSessionUser, hashSessionTokenForTests } from "./session";

afterAll(async () => {
  // Keep the shared pool open for other test files; vitest exits the process.
});

describe("identity tables", () => {
  it("allows a user with no email (Telegram-only)", async () => {
    const [user] = await db
      .insert(users)
      .values({ displayName: "Telegram Meron", email: null })
      .returning();
    expect(user?.email).toBeNull();

    await db.insert(authIdentities).values({
      userId: user!.id,
      provider: "telegram",
      providerUserId: `tg-${Date.now()}`,
    });
  });

  it("rejects a second account with the same email", async () => {
    const email = `unique-${Date.now()}@example.com`;
    await db.insert(users).values({
      displayName: "First",
      email,
      passwordHash: await hashPassword("Secret123"),
    });

    let code: string | undefined;
    try {
      await db.insert(users).values({
        displayName: "Second",
        email,
        passwordHash: await hashPassword("Secret123"),
      });
    } catch (error) {
      let current: unknown = error;
      while (current && typeof current === "object") {
        if ("code" in current && typeof (current as { code: unknown }).code === "string") {
          code = (current as { code: string }).code;
          if (code === "23505") break;
        }
        current = "cause" in current ? (current as { cause: unknown }).cause : null;
      }
    }
    expect(code).toBe("23505");
  });

  it("stores only a hash of the session token", async () => {
    const [user] = await db
      .insert(users)
      .values({
        displayName: "Session User",
        email: `session-${Date.now()}@example.com`,
      })
      .returning();

    const { token } = await createSessionRecord(user!.id);
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user!.id))
      .limit(1);

    expect(row?.tokenHash).toBe(hashSessionTokenForTests(token));
    expect(row?.tokenHash).not.toBe(token);
  });

  it("keeps app and admin logins apart", async () => {
    const [user] = await db
      .insert(users)
      .values({ displayName: "Two Doors", email: `doors-${Date.now()}@example.com` })
      .returning();

    const app = await createSessionRecord(user!.id, {}, "app");
    const admin = await createSessionRecord(user!.id, {}, "admin");

    expect((await findSessionUser(app.token, "app"))?.id).toBe(user!.id);
    expect((await findSessionUser(admin.token, "admin"))?.id).toBe(user!.id);
    // A cookie stolen from the app is useless at the admin address, and the reverse.
    expect(await findSessionUser(app.token, "admin")).toBeNull();
    expect(await findSessionUser(admin.token, "app")).toBeNull();

    // Admin logins are short: hours, not weeks.
    const hours = (date: Date) => (date.getTime() - Date.now()) / 3_600_000;
    expect(hours(admin.expiresAt)).toBeLessThanOrEqual(12);
    expect(hours(app.expiresAt)).toBeGreaterThan(24 * 29);
  });

  it("rejects expired sessions and suspended people", async () => {
    const [user] = await db
      .insert(users)
      .values({ displayName: "Gone", email: `gone-${Date.now()}@example.com` })
      .returning();
    const { token } = await createSessionRecord(user!.id);

    await db.update(users).set({ status: "suspended" }).where(eq(users.id, user!.id));
    expect(await findSessionUser(token, "app")).toBeNull();

    await db.update(users).set({ status: "active" }).where(eq(users.id, user!.id));
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, user!.id));
    expect(await findSessionUser(token, "app")).toBeNull();
  });
});
