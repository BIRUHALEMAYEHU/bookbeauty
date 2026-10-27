import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  entitlementOverrides,
  subscriptions,
  users,
} from "@/db/schema";
import { createIndependentPractice, createSalon } from "@/modules/businesses/create";
import { entitlement } from "./resolve";
import { ensurePlansSeeded } from "./seed";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("plans and entitlements", () => {
  it("seeds the catalogue and attaches a free subscription on create", async () => {
    await ensurePlansSeeded();
    const user = await seedUser("Plan Indie");
    const stamp = Date.now().toString(36);

    const practice = await createIndependentPractice(user.id, {
      handle: `plan-${stamp}`,
      displayName: "Plan Meron",
      category: "nails",
    });
    expect(practice.ok).toBe(true);
    if (!practice.ok) return;

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.businessId, practice.business.id));
    expect(sub?.planKey).toBe("individual_free");
    expect(sub?.status).toBe("free");

    const branches = await entitlement(practice.business.id, "branches");
    expect(branches).toMatchObject({
      enabled: false,
      planKey: "individual_free",
      source: "plan",
    });

    const calendar = await entitlement(practice.business.id, "calendar_sync");
    expect(calendar.enabled).toBe(true);
  });

  it("falls back to free entitlements when a paid subscription lapses", async () => {
    const user = await seedUser("Lapsed Owner");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(user.id, {
      name: "Lapsed Salon",
      slug: `lapsed-${stamp}`,
      category: "spa",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    await db
      .update(subscriptions)
      .set({ planKey: "pro", status: "lapsed" })
      .where(eq(subscriptions.businessId, salon.business.id));

    const branches = await entitlement(salon.business.id, "branches");
    expect(branches.enabled).toBe(false);
    expect(branches.planKey).toBe("business_free");
  });

  it("applies a non-expired override over the plan", async () => {
    const user = await seedUser("Override Owner");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(user.id, {
      name: "Pilot Salon",
      slug: `pilot-${stamp}`,
      category: "hair",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    await db.insert(entitlementOverrides).values({
      businessId: salon.business.id,
      featureKey: "branches",
      enabled: true,
      limitValue: 3,
      reason: "pilot",
    });

    const branches = await entitlement(salon.business.id, "branches");
    expect(branches).toMatchObject({
      enabled: true,
      limit: 3,
      source: "override",
    });
  });
});
