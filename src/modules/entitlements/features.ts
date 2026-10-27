/** Feature keys used as entitlement switches (D76 / Section 20.3). */
export const FEATURE_KEYS = [
  "branches",
  "staff_seats",
  "sms_monthly",
  "photo_storage_mb",
  "staff_management",
  "marketing",
  "analytics",
  "calendar_sync",
  "export",
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FREE_PLAN_BY_AUDIENCE = {
  independent: "individual_free",
  salon: "business_free",
} as const;

export type PlanKey =
  | "individual_free"
  | "business_free"
  | "business"
  | "pro";
