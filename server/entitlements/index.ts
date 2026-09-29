import { prisma } from '../index';
import { PLAN_DEFINITIONS, normalizePlan, resolveEntitlementsFromRows } from './catalog';

export type { PlanId, FeatureKey, EffectiveEntitlements } from './catalog';
export { FEATURE_KEYS, PLAN_DEFINITIONS, hasFeature, normalizePlan } from './catalog';

export async function ensureFreeSubscription(businessId: string) {
  const existing = await prisma.subscription.findUnique({ where: { businessId } });
  if (existing) return existing;
  const free = PLAN_DEFINITIONS.FREE;
  return prisma.subscription.create({
    data: {
      businessId,
      plan: 'FREE',
      status: 'INACTIVE',
      seats: free.limits.maxStaff,
      provider: 'NONE'
    }
  });
}

export async function resolveEntitlements(businessId: string) {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: { subscription: true }
  });
  if (!business) return null;
  return resolveEntitlementsFromRows({
    plan: business.subscription?.plan || business.plan,
    status: business.status,
    subscription: business.subscription
      ? {
          status: business.subscription.status,
          seats: business.subscription.seats,
          plan: business.subscription.plan
        }
      : null
  });
}
