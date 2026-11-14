import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { locations, membershipLocations, memberships, users } from "@/db/schema";
import { createSalon } from "@/modules/businesses/create";
import { forBusiness } from "./scope";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `scope-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("forBusiness", () => {
  it("returns a scope for an active owner", async () => {
    const owner = await seedUser("Scope Owner");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(owner.id, {
      name: "Scoped Salon",
      slug: `scoped-${stamp}`,
      category: "hair",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    const scope = await forBusiness(salon.business.id, owner.id);
    expect(scope).not.toBeNull();
    expect(scope?.actor.role).toBe("owner");
    expect(scope?.can("settings.manage")).toBe(true);
    expect(scope?.can("activity_log.view")).toBe(true);

    const rows = await scope!.select(locations);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(salon.location.id);
  });

  it("returns null for a stranger", async () => {
    const owner = await seedUser("Owner Alone");
    const stranger = await seedUser("Stranger");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(owner.id, {
      name: "Private",
      slug: `private-${stamp}`,
      category: "nails",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    const scope = await forBusiness(salon.business.id, stranger.id);
    expect(scope).toBeNull();
  });

  it("scopes a branch manager to assigned locations only", async () => {
    const owner = await seedUser("Mgr Owner");
    const managerUser = await seedUser("Branch Mgr");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(owner.id, {
      name: "Multi Branch",
      slug: `multi-${stamp}`,
      category: "spa",
      locationName: "Bole",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    const [cmc] = await db
      .insert(locations)
      .values({
        businessId: salon.business.id,
        name: "CMC",
        slug: "cmc",
        isDefault: false,
      })
      .returning();

    const [membership] = await db
      .insert(memberships)
      .values({
        businessId: salon.business.id,
        userId: managerUser.id,
        role: "branch_manager",
        status: "active",
      })
      .returning();

    await db.insert(membershipLocations).values({
      membershipId: membership!.id,
      locationId: salon.location.id,
    });

    const scope = await forBusiness(salon.business.id, managerUser.id);
    expect(scope?.actor.role).toBe("branch_manager");
    expect(scope?.can("bookings.view", { locationId: salon.location.id })).toBe(
      true,
    );
    expect(scope?.can("bookings.view", { locationId: cmc!.id })).toBe(false);
    expect(scope?.can("settings.manage")).toBe(false);
  });

  it("rejects ended memberships", async () => {
    const owner = await seedUser("Ended Owner");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(owner.id, {
      name: "Ended",
      slug: `ended-${stamp}`,
      category: "barber",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    await db
      .update(memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: "resigned" })
      .where(eq(memberships.id, salon.membership.id));

    const scope = await forBusiness(salon.business.id, owner.id);
    expect(scope).toBeNull();
  });
});

async function twoSalons() {
  const ownerA = await seedUser("Owner A");
  const ownerB = await seedUser("Owner B");
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const a = await createSalon(ownerA.id, { name: "Salon A", slug: `a-${stamp}`, category: "hair" });
  const b = await createSalon(ownerB.id, { name: "Salon B", slug: `b-${stamp}`, category: "hair" });
  if (!a.ok || !b.ok) throw new Error("setup failed");
  const scopeA = await forBusiness(a.business.id, ownerA.id);
  if (!scopeA) throw new Error("no scope");
  return { a, b, ownerB, scopeA };
}

describe("scoped queries keep businesses apart", () => {
  it("never reads another business's rows, even when asked for them by id", async () => {
    const { a, b, scopeA } = await twoSalons();

    const all = await scopeA.select(locations);
    expect(all.map((row) => row.businessId)).toEqual([a.business.id]);

    const targeted = await scopeA.select(locations, eq(locations.id, b.location.id));
    expect(targeted).toEqual([]);
  });

  it("stamps its own business on inserts, whatever the caller passes", async () => {
    const { a, b, scopeA } = await twoSalons();

    const [created] = await scopeA.insert(locations, {
      // A caller trying to write into another business:
      ...({ businessId: b.business.id } as object),
      name: "Piassa",
      slug: "piassa",
    });
    expect(created?.businessId).toBe(a.business.id);
  });

  it("cannot change or delete another business's rows", async () => {
    const { b, scopeA } = await twoSalons();

    const updated = await scopeA.update(
      locations,
      { name: "Hijacked" },
      eq(locations.id, b.location.id),
    );
    expect(updated).toEqual([]);

    const deleted = await scopeA.delete(locations, eq(locations.id, b.location.id));
    expect(deleted).toEqual([]);

    const [stillThere] = await db.select().from(locations).where(eq(locations.id, b.location.id));
    expect(stillThere?.name).toBe(b.location.name);
  });

  it("cannot move a row into another business", async () => {
    const { a, b, scopeA } = await twoSalons();

    const [moved] = await scopeA.update(
      locations,
      { businessId: b.business.id, name: "Renamed" },
      eq(locations.id, a.location.id),
    );
    expect(moved?.name).toBe("Renamed");
    expect(moved?.businessId).toBe(a.business.id);
  });

  it("edits its own business row but not its owner", async () => {
    const { a, ownerB, scopeA } = await twoSalons();

    const updated = await scopeA.updateBusiness({ about: "Bole Road", ownerUserId: ownerB.id });
    expect(updated.about).toBe("Bole Road");
    expect(updated.ownerUserId).toBe(a.business.ownerUserId);
    expect((await scopeA.business()).id).toBe(a.business.id);
  });

  it("rolls back every write in a failed transaction", async () => {
    const { scopeA } = await twoSalons();

    await expect(
      scopeA.transaction(async (scoped) => {
        await scoped.insert(locations, { name: "Kazanchis", slug: "kazanchis" });
        // Same slug again breaks the per-business unique index.
        await scoped.insert(locations, { name: "Kazanchis 2", slug: "kazanchis" });
      }),
    ).rejects.toThrow();

    const slugs = (await scopeA.select(locations)).map((row) => row.slug);
    expect(slugs).not.toContain("kazanchis");
  });
});
