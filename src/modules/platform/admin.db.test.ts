import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { activityLog, memberships, sessions, subscriptionPayments, subscriptions, users } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { listActivityForScope } from "@/modules/audit/log";
import { createIndependentPractice, createSalon } from "@/modules/businesses/create";
import { entitlement } from "@/modules/entitlements/resolve";
import { createSessionRecord } from "@/modules/identity/session";
import {
  getBusinessForAdmin,
  listBusinessesForAdmin,
  moveBusinessToFreePlan,
  recordSubscriptionPayment,
  setUserStatus,
} from "./admin";
import { configuredAdminEmails, grantPlatformAdmin, isPlatformAdmin } from "./admins";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedUser(label: string, verified = false) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `padmin-${stamp()}@example.com`,
      emailVerifiedAt: verified ? new Date() : null,
    })
    .returning();
  return user!;
}

function daysFromNow(days: number) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

describe("who is a platform administrator", () => {
  it("accepts a verified email from the configured list, in any letter case", async () => {
    const user = await seedUser("Founder", true);
    expect(await isPlatformAdmin(user.id, [])).toBe(false);
    expect(await isPlatformAdmin(user.id, configuredAdminEmails(` ${user.email!.toUpperCase()} , x@y.z`))).toBe(true);
  });

  it("refuses an unverified email even when it is on the list", async () => {
    const user = await seedUser("Impostor", false);
    expect(await isPlatformAdmin(user.id, [user.email!])).toBe(false);
  });

  it("refuses a suspended administrator", async () => {
    const granter = await seedUser("Granter", true);
    const user = await seedUser("Former Admin", true);
    await grantPlatformAdmin(user.id, granter.id);
    await db.update(users).set({ status: "suspended" }).where(eq(users.id, user.id));
    expect(await isPlatformAdmin(user.id, [])).toBe(false);
  });
});

describe("subscription payments", () => {
  it("records a payment, activates the plan and logs it", async () => {
    const admin = await seedUser("Admin", true);
    const owner = await seedUser("Paying Owner");
    const salon = await createSalon(owner.id, { name: "Paying Salon", slug: `paying-${stamp()}`, category: "hair" });
    if (!salon.ok) throw new Error(salon.error);
    const id = salon.business.id;

    expect((await entitlement(id, "branches")).enabled).toBe(false);

    const paidUntil = daysFromNow(30);
    expect(
      await recordSubscriptionPayment(admin.id, id, {
        planKey: "pro",
        amount: "1500.50",
        method: "telebirr",
        reference: "TX-123",
        paidUntil,
      }),
    ).toEqual({ ok: true });

    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.businessId, id));
    expect(subscription).toMatchObject({ planKey: "pro", status: "active" });
    const [payment] = await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.businessId, id));
    expect(payment).toMatchObject({ amount: 150050, method: "telebirr", reference: "TX-123", periodCovered: paidUntil });
    expect((await entitlement(id, "branches")).enabled).toBe(true);

    const detail = await getBusinessForAdmin(id);
    expect(detail?.payments).toHaveLength(1);
    expect(detail?.paidPlans.map((plan) => plan.key).sort()).toEqual(["business", "pro"]);
    expect((await listBusinessesForAdmin()).find((row) => row.id === id)?.planKey).toBe("pro");

    // The owner sees it in her activity log, with the admin's name.
    const scope = (await forBusiness(id, owner.id))!;
    const log = await listActivityForScope(scope);
    expect(log[0]).toMatchObject({ action: "subscription.payment_recorded", actorName: "Admin" });
  });

  it("falls back to free features when the paid period has run out", async () => {
    const admin = await seedUser("Admin", true);
    const owner = await seedUser("Late Owner");
    const salon = await createSalon(owner.id, { name: "Late Salon", slug: `late-${stamp()}`, category: "spa" });
    if (!salon.ok) throw new Error(salon.error);
    await recordSubscriptionPayment(admin.id, salon.business.id, {
      planKey: "pro",
      amount: 1000,
      method: "cash",
      paidUntil: daysFromNow(10),
    });
    await db
      .update(subscriptions)
      .set({ currentPeriodEnd: new Date(Date.now() - 60_000) })
      .where(eq(subscriptions.businessId, salon.business.id));

    const branches = await entitlement(salon.business.id, "branches");
    expect(branches).toMatchObject({ enabled: false, planKey: "business_free" });
  });

  it("refuses a past date, a bad amount and a plan for the wrong kind of business", async () => {
    const admin = await seedUser("Admin", true);
    const owner = await seedUser("Solo Owner");
    const salon = await createSalon(owner.id, { name: "Strict Salon", slug: `strictpay-${stamp()}`, category: "hair" });
    const solo = await createIndependentPractice(owner.id, { handle: `solo-${stamp()}`, displayName: "Solo", category: "nails" });
    if (!salon.ok || !solo.ok) throw new Error("setup failed");

    const base = { planKey: "business", amount: 500, method: "cash" as const, paidUntil: daysFromNow(30) };
    expect(await recordSubscriptionPayment(admin.id, salon.business.id, { ...base, paidUntil: daysFromNow(-2) })).toEqual({
      ok: false,
      error: "date_in_past",
    });
    expect(await recordSubscriptionPayment(admin.id, salon.business.id, { ...base, amount: -5 })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(await recordSubscriptionPayment(admin.id, solo.business.id, base)).toEqual({
      ok: false,
      error: "plan_not_allowed",
    });
    expect(await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.businessId, salon.business.id))).toEqual([]);
  });

  it("moves a business back to free without deleting anything", async () => {
    const admin = await seedUser("Admin", true);
    const owner = await seedUser("Downgraded Owner");
    const salon = await createSalon(owner.id, { name: "Downgraded", slug: `down-${stamp()}`, category: "hair" });
    if (!salon.ok) throw new Error(salon.error);
    const id = salon.business.id;
    await recordSubscriptionPayment(admin.id, id, { planKey: "business", amount: 800, method: "bank_transfer", paidUntil: daysFromNow(30) });

    expect(await moveBusinessToFreePlan(admin.id, id)).toBe(true);
    const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.businessId, id));
    expect(subscription).toMatchObject({ planKey: "business_free", status: "free", currentPeriodEnd: null });
    // The payment record and the business stay (D46).
    expect(await db.select().from(subscriptionPayments).where(eq(subscriptionPayments.businessId, id))).toHaveLength(1);
    expect(await db.select().from(memberships).where(eq(memberships.businessId, id))).toHaveLength(1);
  });
});

describe("suspending accounts", () => {
  it("suspends, logs out everywhere, logs it, and restores", async () => {
    const admin = await seedUser("Admin", true);
    const target = await seedUser("Trouble");
    await createSessionRecord(target.id);

    expect(await setUserStatus(admin.id, target.id, "suspended")).toEqual({ ok: true });
    const [suspended] = await db.select().from(users).where(eq(users.id, target.id));
    expect(suspended?.status).toBe("suspended");
    expect(await db.select().from(sessions).where(eq(sessions.userId, target.id))).toEqual([]);

    expect(await setUserStatus(admin.id, target.id, "active")).toEqual({ ok: true });
    const actions = (await db.select().from(activityLog).where(eq(activityLog.entityId, target.id))).map((e) => e.action);
    expect(actions.sort()).toEqual(["user.restored", "user.suspended"]);
  });

  it("will not suspend yourself or another administrator", async () => {
    const admin = await seedUser("Admin", true);
    const other = await seedUser("Other Admin", true);
    await grantPlatformAdmin(other.id, admin.id);

    expect(await setUserStatus(admin.id, admin.id, "suspended")).toEqual({ ok: false, error: "cannot_suspend_self" });
    expect(await setUserStatus(admin.id, other.id, "suspended")).toEqual({ ok: false, error: "cannot_suspend_admin" });
  });
});

describe("activity log access", () => {
  it("is refused to staff who may not see it", async () => {
    const owner = await seedUser("Log Owner");
    const stylist = await seedUser("Log Stylist");
    const salon = await createSalon(owner.id, { name: "Log Salon", slug: `log-${stamp()}`, category: "hair" });
    if (!salon.ok) throw new Error(salon.error);
    await db.insert(memberships).values({ businessId: salon.business.id, userId: stylist.id, role: "stylist" });

    const stylistScope = (await forBusiness(salon.business.id, stylist.id))!;
    await expect(listActivityForScope(stylistScope)).rejects.toThrow(/Permission denied/);

    const ownerScope = (await forBusiness(salon.business.id, owner.id))!;
    expect((await listActivityForScope(ownerScope)).map((row) => row.action)).toContain("business.created");
  });
});
