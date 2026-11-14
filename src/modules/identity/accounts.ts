import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { authIdentities, sessions, users } from "@/db/schema";

type Provider = "email" | "google" | "telegram";

/**
 * Creates a user together with the login method that proves who she is. Both
 * rows are written in one transaction so a failure never leaves an account
 * that nobody can log in to.
 */
export async function createUserWithIdentity(
  user: typeof users.$inferInsert,
  identity: { provider: Provider; providerUserId: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const [created] = await tx.insert(users).values(user).returning({ id: users.id });
    if (!created) throw new Error("Failed to create user");
    await tx.insert(authIdentities).values({ userId: created.id, ...identity });
    return created.id;
  });
}

export type GoogleProfile = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
};

export type GoogleAccountResult =
  | { ok: true; userId: string }
  | { ok: false; error: "suspended" };

/**
 * Finds or creates the account for a Google sign-in.
 *
 * Google proves the person owns the email address; a password signup does not
 * (until she verifies it). So when a Google sign-in lands on an existing
 * account whose email was never verified, any password and sessions on it may
 * belong to someone else who registered her address first. They are removed
 * before the Google identity is attached.
 */
export async function resolveGoogleAccount(
  profile: GoogleProfile,
): Promise<GoogleAccountResult> {
  const email = profile.email?.trim().toLowerCase() || null;
  const googleVerified = Boolean(email && profile.email_verified);

  return db.transaction(async (tx) => {
    const [identity] = await tx
      .select({ userId: authIdentities.userId, status: users.status })
      .from(authIdentities)
      .innerJoin(users, eq(authIdentities.userId, users.id))
      .where(
        and(
          eq(authIdentities.provider, "google"),
          eq(authIdentities.providerUserId, profile.sub),
        ),
      )
      .limit(1);

    if (identity) {
      if (identity.status !== "active") return { ok: false, error: "suspended" };
      return { ok: true, userId: identity.userId };
    }

    const [existing] = googleVerified
      ? await tx
          .select({
            id: users.id,
            status: users.status,
            emailVerifiedAt: users.emailVerifiedAt,
          })
          .from(users)
          .where(eq(users.email, email!))
          .limit(1)
      : [];

    if (existing) {
      if (existing.status !== "active") return { ok: false, error: "suspended" };

      if (!existing.emailVerifiedAt) {
        await tx.delete(sessions).where(eq(sessions.userId, existing.id));
        await tx
          .delete(authIdentities)
          .where(
            and(
              eq(authIdentities.userId, existing.id),
              eq(authIdentities.provider, "email"),
            ),
          );
        await tx
          .update(users)
          .set({ passwordHash: null, emailVerifiedAt: new Date(), updatedAt: new Date() })
          .where(eq(users.id, existing.id));
      }

      await tx.insert(authIdentities).values({
        userId: existing.id,
        provider: "google",
        providerUserId: profile.sub,
      });
      return { ok: true, userId: existing.id };
    }

    // An unverified Google email may already belong to another account, so it
    // is not stored; the account is reachable through its Google identity.
    const [created] = await tx
      .insert(users)
      .values({
        displayName: profile.name?.trim() || email || "Google user",
        email: googleVerified ? email : null,
        emailVerifiedAt: googleVerified ? new Date() : null,
      })
      .returning({ id: users.id });
    if (!created) throw new Error("Failed to create user");

    await tx.insert(authIdentities).values({
      userId: created.id,
      provider: "google",
      providerUserId: profile.sub,
    });
    return { ok: true, userId: created.id };
  });
}
