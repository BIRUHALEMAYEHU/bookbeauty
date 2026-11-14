import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { businesses, locations, memberships, users } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { createIndependentPractice, createSalon } from "@/modules/businesses/create";
import { getBusinessPageSettings, updateBusinessPage } from "@/modules/businesses/page-settings";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import { loadPublicBusinessPage, loadPublicProfilePage } from "./pages";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `public-${stamp()}@example.com` })
    .returning();
  return user!;
}

describe("public business page", () => {
  it("shows the salon's published details and its team", async () => {
    const owner = await seedUser("Tigist");
    const hana = await seedUser("Hana");
    const slug = `lounge-${stamp()}`;
    const salon = await createSalon(owner.id, {
      name: "Beauty Lounge",
      slug,
      category: "hair",
      about: "Hair and nails in Bole.",
      phone: "011 123 4567",
      locationName: "Bole",
      addressText: "Bole Road, near Edna Mall",
    });
    if (!salon.ok) throw new Error(salon.error);

    const handle = `hana-${stamp()}`;
    await createProfessionalProfile(hana.id, { handle, displayName: "Hana" });
    await db
      .insert(memberships)
      .values({ businessId: salon.business.id, userId: hana.id, role: "stylist" });

    const page = await loadPublicBusinessPage(slug.toUpperCase());
    expect(page).toEqual({
      id: salon.business.id,
      name: "Beauty Lounge",
      slug,
      category: "hair",
      about: "Hair and nails in Bole.",
      phone: "+251111234567",
      locations: [{ name: "Bole", addressText: "Bole Road, near Edna Mall" }],
      team: [{ displayName: "Hana", handle }],
    });
  });

  it("hides an address the business chose not to show", async () => {
    const owner = await seedUser("Private Owner");
    const slug = `private-${stamp()}`;
    const salon = await createSalon(owner.id, {
      name: "Private Salon",
      slug,
      category: "nails",
      addressText: "Secret street",
    });
    if (!salon.ok) throw new Error(salon.error);
    await db.update(locations).set({ addressPublic: false }).where(eq(locations.businessId, salon.business.id));

    expect((await loadPublicBusinessPage(slug))?.locations).toEqual([
      { name: "Main", addressText: null },
    ]);
  });

  it("is not found for unknown, reserved or archived addresses", async () => {
    expect(await loadPublicBusinessPage(`nobody-${stamp()}`)).toBeNull();
    expect(await loadPublicBusinessPage("dashboard")).toBeNull();

    const owner = await seedUser("Closed Owner");
    const slug = `closed-${stamp()}`;
    const salon = await createSalon(owner.id, { name: "Closed", slug, category: "spa" });
    if (!salon.ok) throw new Error(salon.error);
    await db.update(businesses).set({ status: "archived" }).where(eq(businesses.id, salon.business.id));
    expect(await loadPublicBusinessPage(slug)).toBeNull();
  });

  it("returns only published fields", async () => {
    const owner = await seedUser("Field Owner");
    const slug = `fields-${stamp()}`;
    await createSalon(owner.id, { name: "Fields", slug, category: "hair" });
    const page = await loadPublicBusinessPage(slug);
    expect(Object.keys(page!).sort()).toEqual(
      ["about", "category", "id", "locations", "name", "phone", "slug", "team"].sort(),
    );
  });
});

describe("public professional page", () => {
  it("lists her own practice first, then the salons she works at", async () => {
    const owner = await seedUser("Salon Owner");
    const meron = await seedUser("Meron");
    const handle = `meron-${stamp()}`;
    const practice = await createIndependentPractice(meron.id, {
      handle,
      displayName: "Meron Makeup",
      bio: "Bridal makeup.",
      category: "makeup",
      phone: "0911 23 45 67",
      addressText: "Home studio, CMC",
    });
    const slug = `glow-${stamp()}`;
    const salon = await createSalon(owner.id, { name: "Glow Spa", slug, category: "spa" });
    if (!practice.ok || !salon.ok) throw new Error("setup failed");
    await db.insert(memberships).values({ businessId: salon.business.id, userId: meron.id, role: "stylist" });

    const page = await loadPublicProfilePage(`@${handle}`);
    expect(page).toEqual({
      userId: meron.id,
      handle,
      displayName: "Meron Makeup",
      bio: "Bridal makeup.",
      places: [
        {
          kind: "independent",
          businessId: practice.business.id,
          // Solo practices hide their address unless she turns it on (D56).
          location: { name: "Home", addressText: null },
          phone: "+251911234567",
        },
        { kind: "salon", businessId: salon.business.id, name: "Glow Spa", slug },
      ],
    });
  });

  it("keeps her page after she leaves a salon, without listing it", async () => {
    const owner = await seedUser("Former Owner");
    const hana = await seedUser("Leaving Hana");
    const handle = `leaving-${stamp()}`;
    await createProfessionalProfile(hana.id, { handle, displayName: "Hana" });
    const salon = await createSalon(owner.id, { name: "Old Salon", slug: `old-${stamp()}`, category: "hair" });
    if (!salon.ok) throw new Error(salon.error);
    await db.insert(memberships).values({
      businessId: salon.business.id,
      userId: hana.id,
      role: "stylist",
      status: "ended",
      endedAt: new Date(),
      endReason: "resigned",
    });

    const page = await loadPublicProfilePage(handle);
    expect(page?.displayName).toBe("Hana");
    expect(page?.places).toEqual([]);
  });

  it("is not found for an unknown handle", async () => {
    expect(await loadPublicProfilePage(`ghost-${stamp()}`)).toBeNull();
  });
});

describe("editing the public page", () => {
  it("lets the salon owner change what customers see", async () => {
    const owner = await seedUser("Editing Owner");
    const slug = `edit-${stamp()}`;
    const salon = await createSalon(owner.id, { name: "Before", slug, category: "hair" });
    if (!salon.ok) throw new Error(salon.error);
    const scope = (await forBusiness(salon.business.id, owner.id))!;

    expect(
      await updateBusinessPage(scope, {
        name: "After",
        about: "New about",
        phone: "011 123 4567",
        locationName: "Bole",
        addressText: "Bole Road",
        addressPublic: true,
      }),
    ).toEqual({ ok: true });

    expect(await loadPublicBusinessPage(slug)).toMatchObject({
      name: "After",
      about: "New about",
      phone: "+251111234567",
      locations: [{ name: "Bole", addressText: "Bole Road" }],
    });
  });

  it("saves a solo artist's name and bio on her profile", async () => {
    const meron = await seedUser("Solo Meron");
    const handle = `solo-${stamp()}`;
    const practice = await createIndependentPractice(meron.id, {
      handle,
      displayName: "Meron",
      category: "lashes",
    });
    if (!practice.ok) throw new Error(practice.error);
    const scope = (await forBusiness(practice.business.id, meron.id))!;

    await updateBusinessPage(scope, {
      name: "Meron Lashes",
      about: "Lash extensions.",
      addressText: "CMC",
      addressPublic: true,
    });

    expect(await loadPublicProfilePage(handle)).toMatchObject({
      displayName: "Meron Lashes",
      bio: "Lash extensions.",
      places: [{ kind: "independent", location: { addressText: "CMC" } }],
    });
    expect(await getBusinessPageSettings(scope)).toMatchObject({
      name: "Meron Lashes",
      about: "Lash extensions.",
    });
  });

  it("refuses staff who may not manage settings, and bad phone numbers", async () => {
    const owner = await seedUser("Strict Owner");
    const stylist = await seedUser("Strict Stylist");
    const salon = await createSalon(owner.id, { name: "Strict", slug: `strict-${stamp()}`, category: "hair" });
    if (!salon.ok) throw new Error(salon.error);
    await db.insert(memberships).values({ businessId: salon.business.id, userId: stylist.id, role: "stylist" });

    const stylistScope = (await forBusiness(salon.business.id, stylist.id))!;
    expect(
      await updateBusinessPage(stylistScope, { name: "Taken over", addressPublic: true }),
    ).toEqual({ ok: false, error: "forbidden" });

    const ownerScope = (await forBusiness(salon.business.id, owner.id))!;
    expect(
      await updateBusinessPage(ownerScope, { name: "Strict", phone: "12345", addressPublic: true }),
    ).toEqual({ ok: false, error: "phone_invalid" });
  });
});
