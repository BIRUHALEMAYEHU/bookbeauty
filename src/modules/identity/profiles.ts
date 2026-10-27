import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { professionalProfiles, users, type ProfessionalProfile } from "@/db/schema";
import { normaliseSlug } from "@/lib/slug";

export const createProfileSchema = z.object({
  handle: z.string().trim().min(2).max(40),
  displayName: z.string().trim().min(2).max(80),
  bio: z.string().trim().max(2000).optional(),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;

export type ProfileResult =
  | { ok: true; profile: ProfessionalProfile }
  | {
      ok: false;
      error: "invalid_input" | "handle_taken" | "handle_reserved" | "already_has_profile" | "user_not_found";
    };

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

export async function getProfessionalProfileByUserId(
  userId: string,
): Promise<ProfessionalProfile | null> {
  const [row] = await db
    .select()
    .from(professionalProfiles)
    .where(eq(professionalProfiles.userId, userId))
    .limit(1);
  return row ?? null;
}

export async function getProfessionalProfileByHandle(
  handle: string,
): Promise<ProfessionalProfile | null> {
  const normalised = normaliseSlug(handle);
  if (!normalised) return null;
  const [row] = await db
    .select()
    .from(professionalProfiles)
    .where(eq(professionalProfiles.handle, normalised))
    .limit(1);
  return row ?? null;
}

/**
 * Creates a professional profile for a user. A person has at most one
 * (unique on user_id). Handles are unique across the platform.
 */
export async function createProfessionalProfile(
  userId: string,
  input: CreateProfileInput,
): Promise<ProfileResult> {
  const parsed = createProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const handle = normaliseSlug(parsed.data.handle);
  if (!handle) return { ok: false, error: "handle_reserved" };

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!user) return { ok: false, error: "user_not_found" };

  try {
    const [profile] = await db
      .insert(professionalProfiles)
      .values({
        userId,
        handle,
        displayName: parsed.data.displayName,
        bio: parsed.data.bio ?? null,
      })
      .returning();

    if (!profile) return { ok: false, error: "invalid_input" };
    return { ok: true, profile };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const existing = await getProfessionalProfileByUserId(userId);
    if (existing) return { ok: false, error: "already_has_profile" };
    return { ok: false, error: "handle_taken" };
  }
}
