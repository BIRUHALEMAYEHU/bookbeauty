import "server-only";
import { and, eq, gt, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import {
  businesses,
  entitlementOverrides,
  planEntitlements,
  subscriptions,
} from "@/db/schema";
import { FREE_PLAN_BY_AUDIENCE, type FeatureKey, type PlanKey } from "./features";
import { ensurePlansSeeded } from "./seed";

export type Entitlement = {
  featureKey: FeatureKey;
  enabled: boolean;
  limit: number | null;
  /** Plan key that supplied the base entitlement before overrides. */
  planKey: PlanKey;
  source: "plan" | "override" | "fallback";
};

function freePlanForKind(kind: "independent" | "salon"): PlanKey {
  return FREE_PLAN_BY_AUDIENCE[kind === "independent" ? "independent" : "salon"];
}

/**
 * Resolves one feature switch for a business (technical-plan Section 5).
 * Lapsed paid subscriptions fall back to the matching free plan (D46).
 * Per-business overrides win while not expired.
 */
export async function entitlement(
  businessId: string,
  featureKey: FeatureKey,
): Promise<Entitlement> {
  await ensurePlansSeeded();

  const [business] = await db
    .select({ kind: businesses.kind })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!business) {
    return {
      featureKey,
      enabled: false,
      limit: null,
      planKey: "business_free",
      source: "fallback",
    };
  }

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.businessId, businessId))
    .limit(1);

  let planKey: PlanKey = freePlanForKind(business.kind);
  if (subscription) {
    if (subscription.status === "active" || subscription.status === "free") {
      planKey = subscription.planKey as PlanKey;
    } else if (subscription.status === "lapsed") {
      planKey = freePlanForKind(business.kind);
    }
  }

  const now = new Date();
  const [override] = await db
    .select()
    .from(entitlementOverrides)
    .where(
      and(
        eq(entitlementOverrides.businessId, businessId),
        eq(entitlementOverrides.featureKey, featureKey),
        or(
          isNull(entitlementOverrides.expiresAt),
          gt(entitlementOverrides.expiresAt, now),
        ),
      ),
    )
    .limit(1);

  if (override) {
    return {
      featureKey,
      enabled: override.enabled,
      limit: override.limitValue,
      planKey,
      source: "override",
    };
  }

  const [row] = await db
    .select()
    .from(planEntitlements)
    .where(
      and(
        eq(planEntitlements.planKey, planKey),
        eq(planEntitlements.featureKey, featureKey),
      ),
    )
    .limit(1);

  if (!row) {
    return {
      featureKey,
      enabled: false,
      limit: null,
      planKey,
      source: "fallback",
    };
  }

  return {
    featureKey,
    enabled: row.enabled,
    limit: row.limitValue,
    planKey,
    source: "plan",
  };
}

export async function createFreeSubscription(
  businessId: string,
  kind: "independent" | "salon",
): Promise<void> {
  await ensurePlansSeeded();
  const planKey = freePlanForKind(kind);
  await db
    .insert(subscriptions)
    .values({
      businessId,
      planKey,
      status: "free",
    })
    .onConflictDoNothing({ target: subscriptions.businessId });
}
