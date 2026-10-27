import "server-only";
import { and, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  membershipLocations,
  memberships,
  type Membership,
} from "@/db/schema";
import {
  MEMBERSHIP_ROLES,
  type Actor,
  type MembershipRole,
} from "./permissions";

const ROLE_SET = new Set<string>(MEMBERSHIP_ROLES);

function asRole(role: Membership["role"]): MembershipRole | null {
  return ROLE_SET.has(role) ? (role as MembershipRole) : null;
}

/**
 * Resolves the actor for a user inside a business: active/notice membership
 * plus the locations that membership covers. Returns null when she has no
 * usable membership there.
 */
export async function resolveActor(
  businessId: string,
  userId: string,
): Promise<Actor | null> {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.userId, userId),
        inArray(memberships.status, ["active", "notice"]),
      ),
    )
    .limit(1);

  if (!membership) return null;

  const role = asRole(membership.role);
  if (!role) return null;
  if (membership.status !== "active" && membership.status !== "notice") {
    return null;
  }

  const locationRows = await db
    .select({ locationId: membershipLocations.locationId })
    .from(membershipLocations)
    .where(eq(membershipLocations.membershipId, membership.id));

  return {
    userId,
    businessId,
    membershipId: membership.id,
    role,
    locationIds: locationRows.map((row) => row.locationId),
    status: membership.status,
  };
}

/** Non-ended memberships for a user across all businesses (for hat switching). */
export async function listActingMemberships(userId: string): Promise<Membership[]> {
  return db
    .select()
    .from(memberships)
    .where(and(eq(memberships.userId, userId), ne(memberships.status, "ended")));
}
