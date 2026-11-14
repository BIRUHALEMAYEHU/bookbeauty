import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { authIdentities, sessions, users } from "@/db/schema";
import { capturedEmails } from "@/integrations/email";
import { createUserWithIdentity } from "./accounts";
import { isEmailTokenUsable } from "./email-tokens";
import { sendVerificationEmail, verifyEmail } from "./email-verification";
import { hashPassword, verifyPassword } from "./password";
import { requestPasswordReset, resetPassword } from "./password-reset";
import { createSessionRecord } from "./session";

function uniqueEmail(label: string) {
  return `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function uniqueIp() {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

async function passwordUser(email: string, verified = false) {
  return createUserWithIdentity(
    {
      displayName: "Meron",
      email,
      passwordHash: await hashPassword("Secret123"),
      emailVerifiedAt: verified ? new Date() : null,
    },
    { provider: "email", providerUserId: email },
  );
}

/** The raw token from the newest email sent to this address. */
function tokenSentTo(email: string) {
  const message = [...capturedEmails()].reverse().find((m) => m.to === email);
  const match = message?.text.match(/token=([0-9a-f]{64})/);
  if (!match) throw new Error(`No link emailed to ${email}`);
  return match[1]!;
}

async function getUser(id: string) {
  const [user] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return user!;
}

describe("email verification", () => {
  it("verifies the email from the emailed link, once", async () => {
    const email = uniqueEmail("verify");
    const userId = await passwordUser(email);

    expect(await sendVerificationEmail(userId)).toEqual({ ok: true });
    const message = [...capturedEmails()].reverse().find((m) => m.to === email)!;
    expect(message.subject).toContain("Confirm");
    expect(message.html).toContain("/api/auth/verify-email?token=");

    const token = tokenSentTo(email);
    expect(await verifyEmail(token)).toEqual({ ok: true, userId });
    expect((await getUser(userId)).emailVerifiedAt).not.toBeNull();

    // A used link does not work again.
    expect(await verifyEmail(token)).toEqual({ ok: false });
  });

  it("refuses a link sent to an address the account no longer has", async () => {
    const email = uniqueEmail("old");
    const userId = await passwordUser(email);
    await sendVerificationEmail(userId);
    const token = tokenSentTo(email);

    await db.update(users).set({ email: uniqueEmail("new") }).where(eq(users.id, userId));

    expect(await verifyEmail(token)).toEqual({ ok: false });
    expect((await getUser(userId)).emailVerifiedAt).toBeNull();
  });

  it("does not send for verified, email-less or over-limit accounts", async () => {
    const verifiedId = await passwordUser(uniqueEmail("done"), true);
    expect(await sendVerificationEmail(verifiedId)).toEqual({
      ok: false,
      error: "already_verified",
    });

    const telegramId = await createUserWithIdentity(
      { displayName: "Telegram only", email: null },
      { provider: "telegram", providerUserId: `tg-${Date.now()}-${Math.random()}` },
    );
    expect(await sendVerificationEmail(telegramId)).toEqual({ ok: false, error: "no_email" });

    const busyId = await passwordUser(uniqueEmail("busy"));
    for (let i = 0; i < 3; i++) await sendVerificationEmail(busyId);
    expect(await sendVerificationEmail(busyId)).toEqual({ ok: false, error: "rate_limited" });
  });

  it("rejects made-up tokens", async () => {
    expect(await verifyEmail("")).toEqual({ ok: false });
    expect(await verifyEmail("0".repeat(64))).toEqual({ ok: false });
  });
});

describe("password reset", () => {
  it("answers the same for unknown emails and sends nothing", async () => {
    const email = uniqueEmail("nobody");
    const before = capturedEmails().length;
    expect(await requestPasswordReset(email, { ipAddress: uniqueIp() })).toEqual({ ok: true });
    expect(capturedEmails().length).toBe(before);
  });

  it("sets the new password, verifies the email and ends every session", async () => {
    const email = uniqueEmail("reset");
    const userId = await passwordUser(email);
    await createSessionRecord(userId);

    await requestPasswordReset(email.toUpperCase(), { ipAddress: uniqueIp() });
    const token = tokenSentTo(email);
    expect(await isEmailTokenUsable(token, "reset_password")).toBe(true);

    expect(await resetPassword(token, "Newpass456")).toEqual({ ok: true, userId });

    const user = await getUser(userId);
    expect(await verifyPassword(user.passwordHash!, "Newpass456")).toBe(true);
    expect(await verifyPassword(user.passwordHash!, "Secret123")).toBe(false);
    expect(user.emailVerifiedAt).not.toBeNull();
    expect(await db.select().from(sessions).where(eq(sessions.userId, userId))).toHaveLength(0);

    expect(await isEmailTokenUsable(token, "reset_password")).toBe(false);
    expect(await resetPassword(token, "Another789")).toEqual({
      ok: false,
      error: "link_invalid",
    });
  });

  it("makes older reset links stop working after one is used", async () => {
    const email = uniqueEmail("two-links");
    const userId = await passwordUser(email);
    const ip = uniqueIp();

    await requestPasswordReset(email, { ipAddress: ip });
    const first = tokenSentTo(email);
    await requestPasswordReset(email, { ipAddress: ip });
    const second = tokenSentTo(email);

    expect(await resetPassword(second, "Newpass456")).toEqual({ ok: true, userId });
    expect(await resetPassword(first, "Another789")).toEqual({
      ok: false,
      error: "link_invalid",
    });
  });

  it("gives a Google-only account a password and an email login", async () => {
    const email = uniqueEmail("google");
    const userId = await createUserWithIdentity(
      { displayName: "Sara", email, emailVerifiedAt: new Date() },
      { provider: "google", providerUserId: `sub-${Date.now()}-${Math.random()}` },
    );

    await requestPasswordReset(email, { ipAddress: uniqueIp() });
    expect(await resetPassword(tokenSentTo(email), "Newpass456")).toEqual({ ok: true, userId });

    const providers = (
      await db
        .select({ provider: authIdentities.provider })
        .from(authIdentities)
        .where(eq(authIdentities.userId, userId))
    )
      .map((row) => row.provider)
      .sort();
    expect(providers).toEqual(["email", "google"]);
  });

  it("checks the password rule before using up the link", async () => {
    const email = uniqueEmail("weak");
    await passwordUser(email);
    await requestPasswordReset(email, { ipAddress: uniqueIp() });
    const token = tokenSentTo(email);

    expect(await resetPassword(token, "short")).toEqual({
      ok: false,
      error: "invalid_password",
    });
    expect(await isEmailTokenUsable(token, "reset_password")).toBe(true);
  });

  it("limits how many links one address can be sent", async () => {
    const email = uniqueEmail("flood");
    await passwordUser(email);
    for (let i = 0; i < 3; i++) await requestPasswordReset(email, { ipAddress: uniqueIp() });
    expect(await requestPasswordReset(email, { ipAddress: uniqueIp() })).toEqual({
      ok: false,
      error: "rate_limited",
    });
  });
});
