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

    const filter = scope!.whereBusiness(locations.businessId);
    const rows = await db.select().from(locations).where(filter);
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
