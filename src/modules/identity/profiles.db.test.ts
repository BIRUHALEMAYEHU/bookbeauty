import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { createProfessionalProfile, getProfessionalProfileByHandle } from "./profiles";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `profile-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("createProfessionalProfile", () => {
  it("stores a unique handle", async () => {
    const user = await seedUser("Profile User");
    const handle = `hana-${Date.now().toString(36)}`;

    const result = await createProfessionalProfile(user.id, {
      handle: `@${handle}`,
      displayName: "Hana",
      bio: "Nails in Bole",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.profile.handle).toBe(handle);

    const found = await getProfessionalProfileByHandle(handle);
    expect(found?.id).toBe(result.profile.id);
  });

  it("rejects a second profile for the same user", async () => {
    const user = await seedUser("One Profile");
    const stamp = Date.now().toString(36);

    const first = await createProfessionalProfile(user.id, {
      handle: `one-${stamp}`,
      displayName: "One",
    });
    expect(first.ok).toBe(true);

    const second = await createProfessionalProfile(user.id, {
      handle: `two-${stamp}`,
      displayName: "Two",
    });
    expect(second).toEqual({ ok: false, error: "already_has_profile" });
  });

  it("rejects a taken handle", async () => {
    const a = await seedUser("Handle A");
    const b = await seedUser("Handle B");
    const handle = `taken-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    const first = await createProfessionalProfile(a.id, {
      handle,
      displayName: "Alice",
    });
    expect(first.ok).toBe(true);

    const second = await createProfessionalProfile(b.id, {
      handle,
      displayName: "Betty",
    });
    expect(second).toEqual({ ok: false, error: "handle_taken" });
  });

  it("rejects reserved handles", async () => {
    const user = await seedUser("Reserved");
    const result = await createProfessionalProfile(user.id, {
      handle: "login",
      displayName: "Nope",
    });
    expect(result).toEqual({ ok: false, error: "handle_reserved" });
  });
});
