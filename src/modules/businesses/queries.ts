import "server-only";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  businesses,
  memberships,
  professionalProfiles,
  type Business,
  type Membership,
} from "@/db/schema";

export type MembershipWithBusiness = {
  membership: Membership;
  business: Business;
};

/** Memberships she can act in (active, or working out her notice), with their businesses. */
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
    .where(
      and(
        eq(memberships.userId, userId),
        inArray(memberships.status, ["active", "notice"]),
        eq(businesses.status, "active"),
      ),
    )
    .orderBy(asc(memberships.createdAt));

  return rows;
}

/** One "hat" (D11): a place she can act in, as shown in the switcher. */
export type Hat = {
  businessId: string;
  name: string;
  kind: Business["kind"];
  role: Membership["role"];
  /** Public page address: "/@handle" for a solo practice, "/slug" for a salon. */
  publicPath: string | null;
};

export async function listHats(userId: string): Promise<Hat[]> {
  const rows = await listMembershipsForUser(userId);
  const ownerIds = rows
    .filter((row) => row.business.kind === "independent")
    .map((row) => row.business.ownerUserId);

  const handles = new Map(
    ownerIds.length
      ? (
          await db
            .select({ userId: professionalProfiles.userId, handle: professionalProfiles.handle })
            .from(professionalProfiles)
            .where(inArray(professionalProfiles.userId, ownerIds))
        ).map((row) => [row.userId, row.handle])
      : [],
  );

  return rows.map(({ business, membership }) => {
    const handle = handles.get(business.ownerUserId);
    const publicPath =
      business.kind === "independent"
        ? handle
          ? `/@${handle}`
          : null
        : business.slug
          ? `/${business.slug}`
          : null;
    return {
      businessId: business.id,
      name: business.name,
      kind: business.kind,
      role: membership.role,
      publicPath,
    };
  });
}

/** Her own solo practice, if she has one (at most one, D96). */
export async function getIndependentPractice(userId: string): Promise<Business | null> {
  const [row] = await db
    .select()
    .from(businesses)
    .where(
      and(
        eq(businesses.ownerUserId, userId),
        eq(businesses.kind, "independent"),
        eq(businesses.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
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
