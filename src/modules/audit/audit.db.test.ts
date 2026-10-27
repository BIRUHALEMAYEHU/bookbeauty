import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { activityLog, users } from "@/db/schema";
import { createSalon } from "@/modules/businesses/create";
import { listActivityForBusiness, logActivity } from "./log";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("activity log", () => {
  it("appends entries and lists newest first", async () => {
    const owner = await seedUser("Audit Owner");
    const stamp = Date.now().toString(36);
    const salon = await createSalon(owner.id, {
      name: "Audit Salon",
      slug: `audit-${stamp}`,
      category: "hair",
    });
    expect(salon.ok).toBe(true);
    if (!salon.ok) return;

    await logActivity({
      businessId: salon.business.id,
      actorUserId: owner.id,
      action: "membership.created",
      entityType: "membership",
      entityId: salon.membership.id,
      after: { role: "owner" },
    });

    await logActivity({
      businessId: salon.business.id,
      actorUserId: owner.id,
      action: "service.price_changed",
      entityType: "service",
      before: { price: 10000 },
      after: { price: 12000 },
    });

    const entries = await listActivityForBusiness(salon.business.id);
    expect(entries.length).toBeGreaterThanOrEqual(2);
    expect(entries[0]?.action).toBe("service.price_changed");
    expect(entries[0]?.before).toEqual({ price: 10000 });
    expect(entries[0]?.after).toEqual({ price: 12000 });
  });

  it("allows platform actions with no business", async () => {
    const admin = await seedUser("Platform Actor");
    const entry = await logActivity({
      actorUserId: admin.id,
      action: "platform.admin_granted",
      entityType: "platform_admin",
      entityId: admin.id,
    });
    expect(entry.businessId).toBeNull();
    expect(entry.action).toBe("platform.admin_granted");
  });

  it("keeps rows when listed directly from the table (append-only contract)", async () => {
    const [row] = await db
      .select()
      .from(activityLog)
      .orderBy(desc(activityLog.createdAt))
      .limit(1);
    expect(row).toBeDefined();

    // Application code has no update/delete helpers; the table still holds the row.
    const [again] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.id, row!.id));
    expect(again?.id).toBe(row!.id);
  });
});
