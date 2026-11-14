import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authIdentities, sessions, users } from "@/db/schema";
import { createUserWithIdentity, resolveGoogleAccount } from "./accounts";
import { hashPassword } from "./password";
import { createSessionRecord } from "./session";

function unique(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function getUser(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user!;
}

async function identitiesOf(userId: string) {
  const rows = await db
    .select({ provider: authIdentities.provider })
    .from(authIdentities)
    .where(eq(authIdentities.userId, userId));
  return rows.map((row) => row.provider).sort();
}

describe("createUserWithIdentity", () => {
  it("leaves no user behind when the identity cannot be written", async () => {
    const providerUserId = unique("tg");
    await createUserWithIdentity(
      { displayName: "First", email: null },
      { provider: "telegram", providerUserId },
    );

    const name = unique("Orphan");
    await expect(
      createUserWithIdentity(
        { displayName: name, email: null },
        { provider: "telegram", providerUserId },
      ),
    ).rejects.toThrow();

    const orphans = await db.select().from(users).where(eq(users.displayName, name));
    expect(orphans).toHaveLength(0);
  });
});

describe("resolveGoogleAccount", () => {
  it("creates an account with a verified email on first sign-in", async () => {
    const email = `${unique("new")}@example.com`;
    const result = await resolveGoogleAccount({
      sub: unique("sub"),
      email: email.toUpperCase(),
      email_verified: true,
      name: "Sara",
    });
    if (!result.ok) throw new Error("expected ok");

    const user = await getUser(result.userId);
    expect(user.email).toBe(email);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await identitiesOf(user.id)).toEqual(["google"]);
  });

  it("returns the same account on later sign-ins", async () => {
    const sub = unique("sub");
    const first = await resolveGoogleAccount({ sub, name: "Hana" });
    const second = await resolveGoogleAccount({ sub, name: "Hana" });
    expect(first).toEqual(second);
  });

  it("removes a stranger's password and sessions from an unverified account", async () => {
    const email = `${unique("victim")}@example.com`;
    // Someone registers the victim's address with a password of their own.
    const attackerMadeId = await createUserWithIdentity(
      { displayName: "Not Her", email, passwordHash: await hashPassword("Secret123") },
      { provider: "email", providerUserId: email },
    );
    await createSessionRecord(attackerMadeId);

    const result = await resolveGoogleAccount({
      sub: unique("sub"),
      email,
      email_verified: true,
    });
    expect(result).toEqual({ ok: true, userId: attackerMadeId });

    const user = await getUser(attackerMadeId);
    expect(user.passwordHash).toBeNull();
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await identitiesOf(user.id)).toEqual(["google"]);
    const left = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(left).toHaveLength(0);
  });

  it("keeps the password on an account whose email was already verified", async () => {
    const email = `${unique("verified")}@example.com`;
    const userId = await createUserWithIdentity(
      {
        displayName: "Meron",
        email,
        passwordHash: await hashPassword("Secret123"),
        emailVerifiedAt: new Date(),
      },
      { provider: "email", providerUserId: email },
    );

    const result = await resolveGoogleAccount({
      sub: unique("sub"),
      email,
      email_verified: true,
    });
    expect(result).toEqual({ ok: true, userId });

    const user = await getUser(userId);
    expect(user.passwordHash).not.toBeNull();
    expect(await identitiesOf(userId)).toEqual(["email", "google"]);
  });

  it("does not attach to an existing account when Google has not verified the email", async () => {
    const email = `${unique("unverified")}@example.com`;
    const existingId = await createUserWithIdentity(
      { displayName: "Owner", email, passwordHash: await hashPassword("Secret123") },
      { provider: "email", providerUserId: email },
    );

    const result = await resolveGoogleAccount({
      sub: unique("sub"),
      email,
      email_verified: false,
    });
    if (!result.ok) throw new Error("expected ok");

    expect(result.userId).not.toBe(existingId);
    expect((await getUser(result.userId)).email).toBeNull();
    expect((await getUser(existingId)).passwordHash).not.toBeNull();
  });

  it("refuses a suspended account", async () => {
    const sub = unique("sub");
    const created = await resolveGoogleAccount({ sub });
    if (!created.ok) throw new Error("expected ok");
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, created.userId));

    expect(await resolveGoogleAccount({ sub })).toEqual({ ok: false, error: "suspended" });
  });
});
