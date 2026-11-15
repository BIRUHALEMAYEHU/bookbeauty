import "server-only";
import { and, count, desc, eq, isNull, notInArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  businesses,
  plans,
  platformAdmins,
  professionalProfiles,
  sessions,
  subscriptionPayments,
  subscriptions,
  users,
} from "@/db/schema";
import { toMinorUnits } from "@/lib/money";
import { logActivity } from "@/modules/audit/log";
import { FREE_PLAN_BY_AUDIENCE } from "@/modules/entitlements/features";
import { ensurePlansSeeded } from "@/modules/entitlements/seed";
import { configuredAdminEmails, isPlatformAdmin } from "./admins";

/**
 * The platform administrator's view across every business (playbook 5.1).
 * Every function here assumes the caller already checked isPlatformAdmin().
 */

const LIST_LIMIT = 200;

export async function getPlatformCounts() {
  const adminEmails = configuredAdminEmails();
  const [[userRow], kinds] = await Promise.all([
    db
      .select({ total: count() })
      .from(users)
      .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
      .where(
        adminEmails.length
          ? and(isNull(platformAdmins.userId), or(isNull(users.email), notInArray(users.email, adminEmails)))
          : isNull(platformAdmins.userId),
      ),
    db
      .select({ kind: businesses.kind, total: count() })
      .from(businesses)
      .where(eq(businesses.status, "active"))
      .groupBy(businesses.kind),
  ]);
  const byKind = Object.fromEntries(kinds.map((row) => [row.kind, row.total]));
  return {
    users: userRow?.total ?? 0,
    independents: byKind.independent ?? 0,
    salons: byKind.salon ?? 0,
  };
}

export type AdminBusinessRow = Awaited<ReturnType<typeof listBusinessesForAdmin>>[number];

/** Newest businesses first, with owner and plan. */
export async function listBusinessesForAdmin() {
  return db
    .select({
      id: businesses.id,
      kind: businesses.kind,
      name: businesses.name,
      slug: businesses.slug,
      handle: professionalProfiles.handle,
      status: businesses.status,
      createdAt: businesses.createdAt,
      ownerName: users.displayName,
      ownerEmail: users.email,
      planKey: subscriptions.planKey,
      subscriptionStatus: subscriptions.status,
      paidUntil: subscriptions.currentPeriodEnd,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .leftJoin(
      professionalProfiles,
      sql`${professionalProfiles.userId} = ${businesses.ownerUserId} and ${businesses.kind} = 'independent'`,
    )
    .orderBy(desc(businesses.createdAt))
    .limit(LIST_LIMIT);
}

export async function getBusinessForAdmin(businessId: string) {
  await ensurePlansSeeded();
  const [business] = await db
    .select({
      id: businesses.id,
      kind: businesses.kind,
      name: businesses.name,
      slug: businesses.slug,
      status: businesses.status,
      createdAt: businesses.createdAt,
      ownerName: users.displayName,
      ownerEmail: users.email,
      planKey: subscriptions.planKey,
      subscriptionStatus: subscriptions.status,
      paidUntil: subscriptions.currentPeriodEnd,
    })
    .from(businesses)
    .innerJoin(users, eq(users.id, businesses.ownerUserId))
    .leftJoin(subscriptions, eq(subscriptions.businessId, businesses.id))
    .where(eq(businesses.id, businessId))
    .limit(1);
  if (!business) return null;

  const [payments, availablePlans] = await Promise.all([
    db
      .select({
        id: subscriptionPayments.id,
        amount: subscriptionPayments.amount,
        currency: subscriptionPayments.currency,
        method: subscriptionPayments.method,
        reference: subscriptionPayments.reference,
        periodCovered: subscriptionPayments.periodCovered,
        recordedAt: subscriptionPayments.recordedAt,
        recordedBy: users.displayName,
      })
      .from(subscriptionPayments)
      .innerJoin(users, eq(users.id, subscriptionPayments.recordedByUserId))
      .where(eq(subscriptionPayments.businessId, businessId))
      .orderBy(desc(subscriptionPayments.recordedAt)),
    db
      .select({ key: plans.key, name: plans.name, price: plans.price })
      .from(plans)
      .where(eq(plans.audience, business.kind === "independent" ? "independent" : "salon")),
  ]);

  const freeKey = FREE_PLAN_BY_AUDIENCE[business.kind === "independent" ? "independent" : "salon"];
  return {
    ...business,
    payments,
    paidPlans: availablePlans.filter((plan) => plan.key !== freeKey),
  };
}

export const recordPaymentSchema = z.object({
  planKey: z.string().min(1),
  /** Amount in birr, as typed. */
  amount: z.coerce.number().positive().max(10_000_000),
  method: z.enum(["telebirr", "bank_transfer", "cash", "other"]),
  reference: z.string().trim().max(200).optional(),
  /** Last day the payment covers, "YYYY-MM-DD". */
  paidUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export type RecordPaymentResult =
  | { ok: true }
  | { ok: false; error: "invalid_input" | "not_found" | "plan_not_allowed" | "date_in_past" };

/** End of the given day in Addis Ababa (UTC+3, no daylight saving). */
function endOfDay(date: string): Date {
  return new Date(`${date}T23:59:59+03:00`);
}

/**
 * Records a subscription payment made outside the platform (Telebirr, bank,
 * cash) and switches the business to the paid plan until the given day.
 * The platform never holds the money (D72); this is a record of it.
 */
export async function recordSubscriptionPayment(
  adminUserId: string,
  businessId: string,
  input: z.input<typeof recordPaymentSchema>,
): Promise<RecordPaymentResult> {
  const parsed = recordPaymentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;

  const business = await getBusinessForAdmin(businessId);
  if (!business) return { ok: false, error: "not_found" };
  if (!business.paidPlans.some((plan) => plan.key === data.planKey)) {
    return { ok: false, error: "plan_not_allowed" };
  }

  const periodEnd = endOfDay(data.paidUntil);
  if (Number.isNaN(periodEnd.getTime())) return { ok: false, error: "invalid_input" };
  if (periodEnd < new Date()) return { ok: false, error: "date_in_past" };

  const amount = toMinorUnits(data.amount);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(subscriptionPayments).values({
      businessId,
      amount,
      method: data.method,
      reference: data.reference || null,
      recordedByUserId: adminUserId,
      periodCovered: data.paidUntil,
    });
    await tx
      .insert(subscriptions)
      .values({
        businessId,
        planKey: data.planKey,
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      })
      .onConflictDoUpdate({
        target: subscriptions.businessId,
        set: {
          planKey: data.planKey,
          status: "active",
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          updatedAt: now,
        },
      });
    await logActivity(
      {
        businessId,
        actorUserId: adminUserId,
        action: "subscription.payment_recorded",
        entityType: "subscription",
        entityId: businessId,
        before: { planKey: business.planKey, status: business.subscriptionStatus },
        after: {
          planKey: data.planKey,
          status: "active",
          amount,
          method: data.method,
          paidUntil: data.paidUntil,
        },
      },
      tx,
    );
  });

  return { ok: true };
}

/** Moves a business back to its free plan. Nothing is deleted (D46). */
export async function moveBusinessToFreePlan(
  adminUserId: string,
  businessId: string,
): Promise<boolean> {
  const business = await getBusinessForAdmin(businessId);
  if (!business) return false;
  const freeKey = FREE_PLAN_BY_AUDIENCE[business.kind === "independent" ? "independent" : "salon"];
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .insert(subscriptions)
      .values({ businessId, planKey: freeKey, status: "free" })
      .onConflictDoUpdate({
        target: subscriptions.businessId,
        set: {
          planKey: freeKey,
          status: "free",
          currentPeriodStart: null,
          currentPeriodEnd: null,
          updatedAt: now,
        },
      });
    await logActivity(
      {
        businessId,
        actorUserId: adminUserId,
        action: "subscription.moved_to_free",
        entityType: "subscription",
        entityId: businessId,
        before: { planKey: business.planKey, status: business.subscriptionStatus },
        after: { planKey: freeKey, status: "free" },
      },
      tx,
    );
  });
  return true;
}

export type AdminUserRow = Awaited<ReturnType<typeof listUsersForAdmin>>[number];

/** Newest accounts first. */
export async function listUsersForAdmin() {
  const adminEmails = configuredAdminEmails();
  const rows = await db
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      status: users.status,
      createdAt: users.createdAt,
      granted: platformAdmins.userId,
    })
    .from(users)
    .leftJoin(platformAdmins, eq(platformAdmins.userId, users.id))
    .orderBy(desc(users.createdAt))
    .limit(LIST_LIMIT);

  return rows.map(({ granted, ...row }) => ({
    ...row,
    isAdmin:
      Boolean(granted) ||
      Boolean(row.email && row.emailVerifiedAt && adminEmails.includes(row.email.toLowerCase())),
  }));
}

export type SetUserStatusResult =
  | { ok: true }
  | { ok: false; error: "not_found" | "cannot_suspend_self" | "cannot_suspend_admin" };

/**
 * Suspends or restores an account. Suspending also ends every session, so
 * the person is logged out at once. Administrators cannot be suspended here.
 */
export async function setUserStatus(
  adminUserId: string,
  userId: string,
  status: "active" | "suspended",
): Promise<SetUserStatusResult> {
  const [target] = await db
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!target) return { ok: false, error: "not_found" };

  if (status === "suspended") {
    if (userId === adminUserId) return { ok: false, error: "cannot_suspend_self" };
    if (await isPlatformAdmin(userId)) return { ok: false, error: "cannot_suspend_admin" };
  }
  if (target.status === status) return { ok: true };

  await db.transaction(async (tx) => {
    await tx.update(users).set({ status, updatedAt: new Date() }).where(eq(users.id, userId));
    if (status === "suspended") {
      await tx.delete(sessions).where(eq(sessions.userId, userId));
    }
    await logActivity(
      {
        actorUserId: adminUserId,
        action: status === "suspended" ? "user.suspended" : "user.restored",
        entityType: "user",
        entityId: userId,
        before: { status: target.status },
        after: { status },
      },
      tx,
    );
  });
  return { ok: true };
}
