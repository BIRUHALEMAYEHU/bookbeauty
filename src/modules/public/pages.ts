import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  businesses,
  locations,
  memberships,
  professionalProfiles,
  services,
} from "@/db/schema";
import { normaliseSlug } from "@/lib/slug";

/**
 * What guests see on public pages (F11, F12). Every query names the columns it
 * returns, so nothing private (owner ids, settings, emails) can reach a page
 * by accident. Callers cache these; see src/app/[slug]/data.ts.
 */

const ACTING = ["active", "notice"] as const;

export type PublicLocation = {
  name: string;
  /** Null when the business chose not to show its address (D56). */
  addressText: string | null;
};

/** A service as guests see it (F13). Prices are santim. */
export type PublicService = {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  locationType: (typeof services.locationType.enumValues)[number];
  priceStudio: number | null;
  priceClientPlace: number | null;
  currency: string;
};

export type PublicTeamMember = { displayName: string; handle: string };

export type PublicBusinessPage = {
  id: string;
  name: string;
  slug: string;
  category: (typeof businesses.category.enumValues)[number];
  about: string | null;
  phone: string | null;
  locations: PublicLocation[];
  services: PublicService[];
  team: PublicTeamMember[];
};

export type PublicPlace =
  | { kind: "salon"; businessId: string; name: string; slug: string }
  | {
      kind: "independent";
      businessId: string;
      location: PublicLocation | null;
      phone: string | null;
      services: PublicService[];
    };

export type PublicProfilePage = {
  userId: string;
  handle: string;
  displayName: string;
  bio: string | null;
  places: PublicPlace[];
};

async function publicLocations(businessId: string): Promise<PublicLocation[]> {
  const rows = await db
    .select({
      name: locations.name,
      addressText: locations.addressText,
      addressPublic: locations.addressPublic,
    })
    .from(locations)
    .where(and(eq(locations.businessId, businessId), eq(locations.status, "active")))
    .orderBy(asc(locations.createdAt));
  return rows.map((row) => ({
    name: row.name,
    addressText: row.addressPublic ? row.addressText : null,
  }));
}

/** Active services in the order the business arranged them. */
async function publicServices(businessId: string): Promise<PublicService[]> {
  return db
    .select({
      id: services.id,
      name: services.name,
      description: services.description,
      durationMinutes: services.durationMinutes,
      locationType: services.locationType,
      priceStudio: services.priceStudio,
      priceClientPlace: services.priceClientPlace,
      currency: services.currency,
    })
    .from(services)
    .where(and(eq(services.businessId, businessId), eq(services.status, "active")))
    .orderBy(asc(services.sortOrder), asc(services.createdAt));
}

/** A salon's page at /slug. Null when there is no such active salon. */
export async function loadPublicBusinessPage(rawSlug: string): Promise<PublicBusinessPage | null> {
  const slug = normaliseSlug(rawSlug);
  if (!slug) return null;

  const [business] = await db
    .select({
      id: businesses.id,
      name: businesses.name,
      slug: businesses.slug,
      category: businesses.category,
      about: businesses.about,
      phone: businesses.phone,
    })
    .from(businesses)
    .where(
      and(eq(businesses.slug, slug), eq(businesses.kind, "salon"), eq(businesses.status, "active")),
    )
    .limit(1);
  if (!business?.slug) return null;

  // Team: members who have a professional profile, in the order they joined.
  const team = await db
    .select({ displayName: professionalProfiles.displayName, handle: professionalProfiles.handle })
    .from(memberships)
    .innerJoin(professionalProfiles, eq(professionalProfiles.userId, memberships.userId))
    .where(and(eq(memberships.businessId, business.id), inArray(memberships.status, ACTING)))
    .orderBy(asc(memberships.startedAt));

  return {
    ...business,
    slug: business.slug,
    locations: await publicLocations(business.id),
    services: await publicServices(business.id),
    team,
  };
}

/**
 * A professional's own page at /@handle (D16): permanent, whichever salon she
 * works at. Lists every place she can be booked.
 */
export async function loadPublicProfilePage(rawHandle: string): Promise<PublicProfilePage | null> {
  const handle = normaliseSlug(rawHandle);
  if (!handle) return null;

  const [profile] = await db
    .select({
      userId: professionalProfiles.userId,
      handle: professionalProfiles.handle,
      displayName: professionalProfiles.displayName,
      bio: professionalProfiles.bio,
    })
    .from(professionalProfiles)
    .where(eq(professionalProfiles.handle, handle))
    .limit(1);
  if (!profile) return null;

  const rows = await db
    .select({
      businessId: businesses.id,
      kind: businesses.kind,
      name: businesses.name,
      slug: businesses.slug,
      phone: businesses.phone,
    })
    .from(memberships)
    .innerJoin(businesses, eq(businesses.id, memberships.businessId))
    .where(
      and(
        eq(memberships.userId, profile.userId),
        inArray(memberships.status, ACTING),
        eq(businesses.status, "active"),
      ),
    )
    .orderBy(asc(memberships.startedAt));

  const places: PublicPlace[] = [];
  for (const row of rows) {
    if (row.kind === "salon") {
      if (row.slug) places.push({ kind: "salon", businessId: row.businessId, name: row.name, slug: row.slug });
    } else {
      const [location] = await publicLocations(row.businessId);
      places.push({
        kind: "independent",
        businessId: row.businessId,
        location: location ?? null,
        phone: row.phone,
        services: await publicServices(row.businessId),
      });
    }
  }

  // Her own practice first: on her own page it is the main way to book her.
  places.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "independent" ? -1 : 1));

  return { ...profile, places };
}
