export const FEATURE_KEYS = [
  'booking_page',
  'appointments',
  'customers_basic',
  'staff_management',
  'deposits',
  'marketing',
  'analytics',
  'branches',
  'custom_branding'
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];
export type PlanId = 'FREE' | 'BUSINESS' | 'PRO';

export type FeatureMap = Record<FeatureKey, boolean>;

export type EntitlementLimits = {
  maxStaff: number;
  maxBranches: number;
  maxBookingsPerMonth: number;
  marketingCreditsMonthly: number;
};

export type EffectiveEntitlements = {
  plan: PlanId;
  businessStatus: string;
  features: FeatureMap;
  limits: EntitlementLimits;
};

const allOn = (except: Partial<FeatureMap> = {}): FeatureMap => ({
  booking_page: true,
  appointments: true,
  customers_basic: true,
  staff_management: true,
  deposits: true,
  marketing: true,
  analytics: true,
  branches: true,
  custom_branding: true,
  ...except
});

export const PLAN_DEFINITIONS: Record<
  PlanId,
  { features: FeatureMap; limits: EntitlementLimits }
> = {
  FREE: {
    features: allOn({
      staff_management: false,
      deposits: false,
      marketing: false,
      analytics: false,
      branches: false,
      custom_branding: false
    }),
    limits: {
      maxStaff: 1,
      maxBranches: 1,
      maxBookingsPerMonth: 40,
      marketingCreditsMonthly: 0
    }
  },
  BUSINESS: {
    features: allOn({ branches: false }),
    limits: {
      maxStaff: 8,
      maxBranches: 1,
      maxBookingsPerMonth: 500,
      marketingCreditsMonthly: 200
    }
  },
  PRO: {
    features: allOn(),
    limits: {
      maxStaff: 40,
      maxBranches: 20,
      maxBookingsPerMonth: 5000,
      marketingCreditsMonthly: 2000
    }
  }
};

export const normalizePlan = (plan: string | null | undefined): PlanId => {
  const p = String(plan || 'FREE').toUpperCase();
  if (p === 'BUSINESS' || p === 'PRO') return p;
  return 'FREE';
};

export function resolveEntitlementsFromRows(input: {
  plan: string;
  status: string;
  subscription?: { status: string; seats: number; plan?: string | null } | null;
}): EffectiveEntitlements {
  const plan = normalizePlan(input.subscription?.plan || input.plan);
  const base = PLAN_DEFINITIONS[plan];
  return {
    plan,
    businessStatus: input.status || 'ACTIVE',
    features: { ...base.features },
    limits: {
      ...base.limits,
      maxStaff: input.subscription?.seats ?? base.limits.maxStaff
    }
  };
}

export function hasFeature(e: EffectiveEntitlements, key: FeatureKey) {
  return Boolean(e.features[key]);
}
