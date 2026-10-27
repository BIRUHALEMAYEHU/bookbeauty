import "server-only";
import { and, eq, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  businesses,
  memberships,
  type Business,
  type Membership,
} from "@/db/schema";

export type MembershipWithBusiness = {
  membership: Membership;
  business: Business;
};

/** Active (non-ended) memberships for a user, with their businesses. */
export async function listMembershipsForUser(
  userId: string,
): Promise<MembershipWithBusiness[]> {
  const rows = await db
    .select({
      membership: memberships,
      business: businesses,
    })
    .from(memberships)
    .innerJoin(businesses, eq(memberships.businessId, businesses.id))
    .where(and(eq(memberships.userId, userId), ne(memberships.status, "ended")));

  return rows;
}

export async function getBusinessById(businessId: string): Promise<Business | null> {
  const [row] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);
  return row ?? null;
}

export async function getBusinessBySlug(slug: string): Promise<Business | null> {
  const [row] = await db
    .select()
    .from(businesses)
    .where(eq(businesses.slug, slug))
    .limit(1);
  return row ?? null;
}

export async function getActiveMembership(
  businessId: string,
  userId: string,
): Promise<Membership | null> {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.businessId, businessId),
        eq(memberships.userId, userId),
        ne(memberships.status, "ended"),
      ),
    )
    .limit(1);
  return row ?? null;
}
