import "server-only";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { locations } from "@/db/schema";
import type { BusinessScope } from "@/db/scope";
import { normaliseContactPhone } from "@/lib/phone";
import {
  getProfessionalProfileByUserId,
  updateProfessionalProfile,
} from "@/modules/identity/profiles";

/** The fields a public page shows (F11, F12). Name and about are the salon's; bio is hers. */
export const businessPageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  about: z.string().trim().max(4000).optional(),
  phone: z.string().trim().max(40).optional(),
  locationName: z.string().trim().min(1).max(80).optional(),
  addressText: z.string().trim().max(500).optional(),
  addressPublic: z.boolean(),
});

export type BusinessPageInput = z.input<typeof businessPageSchema>;

export type BusinessPageResult =
  | { ok: true }
  | { ok: false; error: "invalid_input" | "phone_invalid" | "forbidden" };

/** Current values for the edit form. */
export async function getBusinessPageSettings(scope: BusinessScope) {
  const business = await scope.business();
  const [location] = await scope.select(locations, eq(locations.isDefault, true));
  const profile =
    business.kind === "independent"
      ? await getProfessionalProfileByUserId(business.ownerUserId)
      : null;
  return {
    kind: business.kind,
    name: profile?.displayName ?? business.name,
    about: (profile ? profile.bio : business.about) ?? "",
    phone: business.phone ?? "",
    locationName: location?.name ?? "",
    addressText: location?.addressText ?? "",
    addressPublic: location?.addressPublic ?? false,
  };
}

/**
 * Saves the public page. For a solo practice the name and bio are her
 * professional profile's (one identity, D16), so they are saved there too.
 */
export async function updateBusinessPage(
  scope: BusinessScope,
  input: BusinessPageInput,
): Promise<BusinessPageResult> {
  if (!scope.can("settings.manage")) return { ok: false, error: "forbidden" };

  const parsed = businessPageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;

  let phone: string | null = null;
  if (data.phone) {
    phone = normaliseContactPhone(data.phone);
    if (!phone) return { ok: false, error: "phone_invalid" };
  }

  const before = await getBusinessPageSettings(scope);
  const independent = before.kind === "independent";

  if (independent) {
    await updateProfessionalProfile(scope.actor.userId, {
      displayName: data.name,
      bio: data.about,
    });
  }

  await scope.transaction(async (scoped) => {
    await scoped.updateBusiness({
      name: data.name,
      // A solo practice's "about" is her bio, kept on the profile.
      about: independent ? null : data.about || null,
      phone,
    });
    await scoped.update(
      locations,
      {
        ...(independent || !data.locationName ? {} : { name: data.locationName }),
        addressText: data.addressText || null,
        addressPublic: data.addressPublic,
        updatedAt: new Date(),
      },
      eq(locations.isDefault, true),
    );
    await scoped.log({
      action: "business.page_updated",
      entityType: "business",
      entityId: scope.businessId,
      before,
      after: { ...data, phone },
    });
  });

  return { ok: true };
}
