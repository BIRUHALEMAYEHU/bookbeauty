import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { locations, memberships, users } from "@/db/schema";
import { createIndependentPractice, createSalon } from "./create";
import { listMembershipsForUser } from "./queries";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("createIndependentPractice", () => {
  it("creates profile, business, default location and owner membership", async () => {
    const user = await seedUser("Meron Independent");
    const handle = `meron-${Date.now().toString(36)}`;

    const result = await createIndependentPractice(user.id, {
      handle,
      displayName: "Meron Hair",
      category: "hair",
      phone: "0911 23 45 67",
      addressText: "Bole, near Edna Mall",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.profile.handle).toBe(handle);
    expect(result.business.kind).toBe("independent");
    expect(result.business.slug).toBeNull();
    expect(result.business.phone).toBe("+251911234567");
    expect(result.location.isDefault).toBe(true);
    expect(result.location.addressPublic).toBe(false);
    expect(result.membership.role).toBe("owner");
    expect(result.membership.status).toBe("active");

    const listed = await listMembershipsForUser(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.business.id).toBe(result.business.id);
  });

  it("rejects a second independent practice for the same person", async () => {
    const user = await seedUser("Second Independent");
    const base = Date.now().toString(36);

    const first = await createIndependentPractice(user.id, {
      handle: `first-${base}`,
      displayName: "First",
      category: "nails",
    });
    expect(first.ok).toBe(true);

    const second = await createIndependentPractice(user.id, {
      handle: `second-${base}`,
      displayName: "Second",
      category: "nails",
    });
    expect(second).toEqual({ ok: false, error: "already_has_independent" });
  });
});

describe("createSalon", () => {
  it("creates a salon with slug, default location and owner membership", async () => {
    const user = await seedUser("Salon Owner");
    const slug = `lounge-${Date.now().toString(36)}`;

    const result = await createSalon(user.id, {
      name: "Beauty Lounge",
      slug,
      category: "spa",
      locationName: "Bole",
      addressText: "Bole Road",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.business.kind).toBe("salon");
    expect(result.business.slug).toBe(slug);
    expect(result.location.name).toBe("Bole");
    expect(result.location.slug).toBe("bole");
    expect(result.membership.role).toBe("owner");

    const [stored] = await db
      .select()
      .from(locations)
      .where(eq(locations.businessId, result.business.id));
    expect(stored?.isDefault).toBe(true);
  });

  it("rejects a duplicate salon slug", async () => {
    const ownerA = await seedUser("Owner A");
    const ownerB = await seedUser("Owner B");
    const slug = `shared-${Date.now().toString(36)}`;

    const first = await createSalon(ownerA.id, {
      name: "First Salon",
      slug,
      category: "hair",
    });
    expect(first.ok).toBe(true);

    const second = await createSalon(ownerB.id, {
      name: "Second Salon",
      slug,
      category: "hair",
    });
    expect(second).toEqual({ ok: false, error: "slug_taken" });
  });

  it("lets one person own a salon and an independent practice", async () => {
    const user = await seedUser("Both Hats");
    const stamp = Date.now().toString(36);

    const independent = await createIndependentPractice(user.id, {
      handle: `both-${stamp}`,
      displayName: "Weekend Meron",
      category: "makeup",
    });
    expect(independent.ok).toBe(true);

    const salon = await createSalon(user.id, {
      name: "Weekday Salon",
      slug: `weekday-${stamp}`,
      category: "makeup",
    });
    expect(salon.ok).toBe(true);

    const listed = await listMembershipsForUser(user.id);
    expect(listed).toHaveLength(2);

    const kinds = listed.map((row) => row.business.kind).sort();
    expect(kinds).toEqual(["independent", "salon"]);
  });
});

describe("membership uniqueness", () => {
  it("allows only one non-ended membership per user per business", async () => {
    const user = await seedUser("Dup Member");
    const stamp = Date.now().toString(36);
    const created = await createSalon(user.id, {
      name: "Only Once",
      slug: `once-${stamp}`,
      category: "barber",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    let code: string | undefined;
    try {
      await db.insert(memberships).values({
        businessId: created.business.id,
        userId: user.id,
        role: "stylist",
        status: "active",
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

    // After ending the membership, a new one can be added.
    await db
      .update(memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: "resigned" })
      .where(eq(memberships.id, created.membership.id));

    const [again] = await db
      .insert(memberships)
      .values({
        businessId: created.business.id,
        userId: user.id,
        role: "stylist",
        status: "active",
      })
      .returning();
    expect(again?.role).toBe("stylist");
  });
});
