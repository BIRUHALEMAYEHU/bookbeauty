import "server-only";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  businesses,
  locations,
  membershipLocations,
  memberships,
  professionalProfiles,
  users,
  type Business,
  type Location,
  type Membership,
  type ProfessionalProfile,
} from "@/db/schema";
import { normalisePhone } from "@/lib/phone";
import { normaliseSlug } from "@/lib/slug";
import { createFreeSubscription } from "@/modules/entitlements/resolve";

const categorySchema = z.enum([
  "hair",
  "barber",
  "nails",
  "makeup",
  "lashes",
  "spa",
  "other",
]);

export const createIndependentSchema = z.object({
  handle: z.string().trim().min(2).max(40),
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(2000).optional(),
  category: categorySchema,
  phone: z.string().trim().max(40).optional(),
  addressText: z.string().trim().max(500).optional(),
  addressPublic: z.boolean().optional(),
});

export const createSalonSchema = z.object({
  name: z.string().trim().min(2).max(120),
  slug: z.string().trim().min(2).max(40),
  category: categorySchema,
  phone: z.string().trim().max(40).optional(),
  about: z.string().trim().max(4000).optional(),
  locationName: z.string().trim().min(1).max(80).optional().default("Main"),
  locationSlug: z.string().trim().min(2).max(40).optional(),
  addressText: z.string().trim().max(500).optional(),
});

export type CreateIndependentInput = z.input<typeof createIndependentSchema>;
export type CreateSalonInput = z.input<typeof createSalonSchema>;

export type BusinessCreateError =
  | "invalid_input"
  | "user_not_found"
  | "handle_taken"
  | "handle_reserved"
  | "slug_taken"
  | "slug_reserved"
  | "already_has_independent"
  | "phone_invalid";

export type IndependentResult =
  | {
      ok: true;
      business: Business;
      location: Location;
      membership: Membership;
      profile: ProfessionalProfile;
    }
  | { ok: false; error: BusinessCreateError };

export type SalonResult =
  | {
      ok: true;
      business: Business;
      location: Location;
      membership: Membership;
    }
  | { ok: false; error: BusinessCreateError };

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if ("code" in current && (current as { code: unknown }).code === "23505") {
      return true;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }
  return false;
}

function uniqueConstraint(error: unknown): string | null {
  let current: unknown = error;
  while (current && typeof current === "object") {
    if (
      "constraint_name" in current &&
      typeof (current as { constraint_name: unknown }).constraint_name === "string"
    ) {
      return (current as { constraint_name: string }).constraint_name;
    }
    if (
      "constraint" in current &&
      typeof (current as { constraint: unknown }).constraint === "string"
    ) {
      return (current as { constraint: string }).constraint;
    }
    current = "cause" in current ? (current as { cause: unknown }).cause : null;
  }
  return null;
}

function phoneOrError(
  raw: string | undefined,
): { ok: true; phone: string | null } | { ok: false; error: "phone_invalid" } {
  if (!raw) return { ok: true, phone: null };
  const phone = normalisePhone(raw);
  if (!phone) return { ok: false, error: "phone_invalid" };
  return { ok: true, phone };
}

/**
 * Creates an independent practice (D96): professional profile, business
 * (kind=independent, no slug), default location, and owner membership.
 */
export async function createIndependentPractice(
  userId: string,
  input: CreateIndependentInput,
): Promise<IndependentResult> {
  const parsed = createIndependentSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const handle = normaliseSlug(parsed.data.handle);
  if (!handle) return { ok: false, error: "handle_reserved" };

  const phoneResult = phoneOrError(parsed.data.phone);
  if (!phoneResult.ok) return phoneResult;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "user_not_found" };

  const existingIndependent = await db
    .select({ id: businesses.id })
    .from(businesses)
    .where(
      and(
        eq(businesses.ownerUserId, userId),
        eq(businesses.kind, "independent"),
        eq(businesses.status, "active"),
      ),
    )
    .limit(1);
  if (existingIndependent[0]) return { ok: false, error: "already_has_independent" };

  try {
    return await db.transaction(async (tx) => {
      let profile = (
        await tx
          .select()
          .from(professionalProfiles)
          .where(eq(professionalProfiles.userId, userId))
          .limit(1)
      )[0];

      if (!profile) {
        const [created] = await tx
          .insert(professionalProfiles)
          .values({
            userId,
            handle,
            displayName: parsed.data.displayName,
            bio: parsed.data.bio ?? null,
          })
          .returning();
        if (!created) return { ok: false as const, error: "invalid_input" as const };
        profile = created;
      }

      const [business] = await tx
        .insert(businesses)
        .values({
          kind: "independent",
          name: parsed.data.displayName,
          slug: null,
          category: parsed.data.category,
          ownerUserId: userId,
          phone: phoneResult.phone,
        })
        .returning();
      if (!business) return { ok: false as const, error: "invalid_input" as const };

      const [location] = await tx
        .insert(locations)
        .values({
          businessId: business.id,
          name: "Home",
          slug: "main",
          addressText: parsed.data.addressText ?? null,
          addressPublic: parsed.data.addressPublic ?? false,
          isDefault: true,
        })
        .returning();
      if (!location) return { ok: false as const, error: "invalid_input" as const };

      const [membership] = await tx
        .insert(memberships)
        .values({
          businessId: business.id,
          userId,
          role: "owner",
          status: "active",
        })
        .returning();
      if (!membership) return { ok: false as const, error: "invalid_input" as const };

      await tx.insert(membershipLocations).values({
        membershipId: membership.id,
        locationId: location.id,
      });

      // Subscription seed runs outside this tx (plans catalogue); the row is
      // created immediately after commit below.
      return { ok: true as const, business, location, membership, profile };
    }).then(async (result) => {
      if (result.ok) {
        await createFreeSubscription(result.business.id, "independent");
      }
      return result;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const name = uniqueConstraint(error) ?? "";
    if (name.includes("handle")) return { ok: false, error: "handle_taken" };
    if (name.includes("independent")) return { ok: false, error: "already_has_independent" };
    return { ok: false, error: "already_has_independent" };
  }
}

/**
 * Creates a salon business with a unique slug, default location, and owner
 * membership. The owner does not need a professional profile (they may never
 * serve customers).
 */
export async function createSalon(
  userId: string,
  input: CreateSalonInput,
): Promise<SalonResult> {
  const parsed = createSalonSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const slug = normaliseSlug(parsed.data.slug);
  if (!slug) return { ok: false, error: "slug_reserved" };

  const locationSlug = normaliseSlug(
    parsed.data.locationSlug ?? parsed.data.locationName,
  );
  if (!locationSlug) return { ok: false, error: "slug_reserved" };

  const phoneResult = phoneOrError(parsed.data.phone);
  if (!phoneResult.ok) return phoneResult;

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "user_not_found" };

  try {
    return await db.transaction(async (tx) => {
      const [business] = await tx
        .insert(businesses)
        .values({
          kind: "salon",
          name: parsed.data.name,
          slug,
          category: parsed.data.category,
          ownerUserId: userId,
          about: parsed.data.about ?? null,
          phone: phoneResult.phone,
        })
        .returning();
      if (!business) return { ok: false as const, error: "invalid_input" as const };

      const [location] = await tx
        .insert(locations)
        .values({
          businessId: business.id,
          name: parsed.data.locationName,
          slug: locationSlug,
          addressText: parsed.data.addressText ?? null,
          addressPublic: true,
          isDefault: true,
        })
        .returning();
      if (!location) return { ok: false as const, error: "invalid_input" as const };

      const [membership] = await tx
        .insert(memberships)
        .values({
          businessId: business.id,
          userId,
          role: "owner",
          status: "active",
        })
        .returning();
      if (!membership) return { ok: false as const, error: "invalid_input" as const };

      await tx.insert(membershipLocations).values({
        membershipId: membership.id,
        locationId: location.id,
      });

      return { ok: true as const, business, location, membership };
    }).then(async (result) => {
      if (result.ok) {
        await createFreeSubscription(result.business.id, "salon");
      }
      return result;
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return { ok: false, error: "slug_taken" };
  }
}
