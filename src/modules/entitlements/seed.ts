import "server-only";
import { db } from "@/db/client";
import { planEntitlements, plans } from "@/db/schema";

/**
 * Illustrative defaults from playbook Section 20.2. Limits are placeholders
 * until pricing is decided; changing them is a data change, not a code change.
 */
const PLAN_ROWS = [
  {
    key: "individual_free",
    name: "Individual",
    audience: "independent" as const,
    price: 0,
    billingPeriod: null,
  },
  {
    key: "business_free",
    name: "Business Free",
    audience: "salon" as const,
    price: 0,
    billingPeriod: null,
  },
  {
    key: "business",
    name: "Business",
    audience: "salon" as const,
    price: 0,
    billingPeriod: "monthly" as const,
  },
  {
    key: "pro",
    name: "Pro",
    audience: "salon" as const,
    price: 0,
    billingPeriod: "monthly" as const,
  },
];

const ENTITLEMENT_ROWS: {
  planKey: string;
  featureKey: string;
  enabled: boolean;
  limitValue: number | null;
}[] = [
  // Independent free: generous, no staff/branches
  { planKey: "individual_free", featureKey: "branches", enabled: false, limitValue: 1 },
  { planKey: "individual_free", featureKey: "staff_seats", enabled: false, limitValue: 1 },
  { planKey: "individual_free", featureKey: "staff_management", enabled: false, limitValue: null },
  { planKey: "individual_free", featureKey: "sms_monthly", enabled: true, limitValue: 20 },
  { planKey: "individual_free", featureKey: "photo_storage_mb", enabled: true, limitValue: 200 },
  { planKey: "individual_free", featureKey: "marketing", enabled: false, limitValue: null },
  { planKey: "individual_free", featureKey: "analytics", enabled: false, limitValue: null },
  { planKey: "individual_free", featureKey: "calendar_sync", enabled: true, limitValue: null },
  { planKey: "individual_free", featureKey: "export", enabled: true, limitValue: null },

  // Business free: one location, few seats
  { planKey: "business_free", featureKey: "branches", enabled: false, limitValue: 1 },
  { planKey: "business_free", featureKey: "staff_seats", enabled: true, limitValue: 3 },
  { planKey: "business_free", featureKey: "staff_management", enabled: true, limitValue: null },
  { planKey: "business_free", featureKey: "sms_monthly", enabled: true, limitValue: 50 },
  { planKey: "business_free", featureKey: "photo_storage_mb", enabled: true, limitValue: 500 },
  { planKey: "business_free", featureKey: "marketing", enabled: false, limitValue: null },
  { planKey: "business_free", featureKey: "analytics", enabled: false, limitValue: null },
  { planKey: "business_free", featureKey: "calendar_sync", enabled: true, limitValue: null },
  { planKey: "business_free", featureKey: "export", enabled: true, limitValue: null },

  // Business paid
  { planKey: "business", featureKey: "branches", enabled: false, limitValue: 1 },
  { planKey: "business", featureKey: "staff_seats", enabled: true, limitValue: 10 },
  { planKey: "business", featureKey: "staff_management", enabled: true, limitValue: null },
  { planKey: "business", featureKey: "sms_monthly", enabled: true, limitValue: 200 },
  { planKey: "business", featureKey: "photo_storage_mb", enabled: true, limitValue: 2000 },
  { planKey: "business", featureKey: "marketing", enabled: true, limitValue: null },
  { planKey: "business", featureKey: "analytics", enabled: true, limitValue: null },
  { planKey: "business", featureKey: "calendar_sync", enabled: true, limitValue: null },
  { planKey: "business", featureKey: "export", enabled: true, limitValue: null },

  // Pro: branches
  { planKey: "pro", featureKey: "branches", enabled: true, limitValue: null },
  { planKey: "pro", featureKey: "staff_seats", enabled: true, limitValue: null },
  { planKey: "pro", featureKey: "staff_management", enabled: true, limitValue: null },
  { planKey: "pro", featureKey: "sms_monthly", enabled: true, limitValue: 1000 },
  { planKey: "pro", featureKey: "photo_storage_mb", enabled: true, limitValue: 10000 },
  { planKey: "pro", featureKey: "marketing", enabled: true, limitValue: null },
  { planKey: "pro", featureKey: "analytics", enabled: true, limitValue: null },
  { planKey: "pro", featureKey: "calendar_sync", enabled: true, limitValue: null },
  { planKey: "pro", featureKey: "export", enabled: true, limitValue: null },
];

let seeded = false;

/** Idempotent plan catalogue seed. Safe to call on every request path that needs plans. */
export async function ensurePlansSeeded(): Promise<void> {
  if (seeded) return;

  await db
    .insert(plans)
    .values(PLAN_ROWS)
    .onConflictDoNothing({ target: plans.key });

  for (const row of ENTITLEMENT_ROWS) {
    await db
      .insert(planEntitlements)
      .values(row)
      .onConflictDoNothing({
        target: [planEntitlements.planKey, planEntitlements.featureKey],
      });
  }

  seeded = true;
}
