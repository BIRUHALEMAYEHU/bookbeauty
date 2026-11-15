import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { activityLog, memberships, serviceProviders, services, users } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { createIndependentPractice, createSalon } from "@/modules/businesses/create";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import { loadPublicBusinessPage, loadPublicProfilePage } from "@/modules/public/pages";
import {
  createService,
  getService,
  listServices,
  moveService,
  parsePrice,
  setServiceArchived,
  updateService,
  type ServiceInput,
} from "./services";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `catalog-${stamp()}@example.com` })
    .returning();
  return user!;
}

/** A salon with an owner (no profile) and one stylist, Hana, who has a profile. */
async function seedSalon() {
  const owner = await seedUser("Owner");
  const hana = await seedUser("Hana Account");
  const slug = `catalog-${stamp()}`;
  const salon = await createSalon(owner.id, { name: "Catalog Salon", slug, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  await createProfessionalProfile(hana.id, { handle: `hana-${stamp()}`, displayName: "Hana" });
  const [hanaMembership] = await db
    .insert(memberships)
    .values({ businessId: salon.business.id, userId: hana.id, role: "stylist" })
    .returning();
  const scope = (await forBusiness(salon.business.id, owner.id))!;
  const hanaScope = (await forBusiness(salon.business.id, hana.id))!;
  return { owner, hana, slug, salon, scope, hanaScope, hanaMembership: hanaMembership! };
}

const braids: ServiceInput = {
  name: "Shuruba (braids)",
  description: "Hair not included.",
  durationMinutes: 150,
  bufferMinutes: 15,
  locationType: "studio",
  priceStudio: 80_000,
  priceClientPlace: null,
  providerMembershipIds: [],
};

describe("parsePrice", () => {
  it("reads birr as santim without rounding errors", () => {
    expect(parsePrice("800")).toBe(80_000);
    expect(parsePrice("1,250.50")).toBe(125_050);
    expect(parsePrice("19.99")).toBe(1_999);
    expect(parsePrice("0")).toBe(0);
  });

  it("rejects anything that is not a price", () => {
    for (const text of ["", "abc", "-5", "12.345", "1e3", "99999999"]) {
      expect(parsePrice(text), text).toBeNull();
    }
  });
});

describe("services in a salon", () => {
  it("creates a service with who performs it, and logs it", async () => {
    const { scope, hanaMembership } = await seedSalon();

    const result = await createService(scope, {
      ...braids,
      providerMembershipIds: [hanaMembership.id],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [listed] = await listServices(scope);
    expect(listed).toMatchObject({
      name: "Shuruba (braids)",
      durationMinutes: 150,
      bufferMinutes: 15,
      priceStudio: 80_000,
      priceClientPlace: null,
      currency: "ETB",
      status: "active",
      providerMembershipIds: [hanaMembership.id],
    });

    const [entry] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, result.service.id))
      .orderBy(desc(activityLog.createdAt));
    expect(entry?.action).toBe("service.created");
    expect(entry?.businessId).toBe(scope.businessId);
  });

  it("needs a price for each place the service is offered", async () => {
    const { scope } = await seedSalon();

    expect(await createService(scope, { ...braids, priceStudio: null })).toEqual({
      ok: false,
      error: "price_required",
    });
    expect(await createService(scope, { ...braids, locationType: "both" })).toEqual({
      ok: false,
      error: "price_required",
    });

    // A price for a place it is not offered at is dropped.
    const visit = await createService(scope, {
      ...braids,
      locationType: "client_place",
      priceStudio: 80_000,
      priceClientPlace: 100_000,
    });
    expect(visit.ok && visit.service.priceStudio).toBeNull();
    expect(visit.ok && visit.service.priceClientPlace).toBe(100_000);
  });

  it("rejects bad lengths and names", async () => {
    const { scope } = await seedSalon();
    for (const bad of [
      { name: "x" },
      { durationMinutes: 0 },
      { durationMinutes: 47 },
      { durationMinutes: 24 * 60 },
      { bufferMinutes: -5 },
      { priceStudio: -1 },
      { priceStudio: 12.5 },
    ]) {
      expect(await createService(scope, { ...braids, ...bad }), JSON.stringify(bad)).toEqual({
        ok: false,
        error: "invalid_input",
      });
    }
  });

  it("only lets people on this team, with a profile, perform a service", async () => {
    const { scope, salon } = await seedSalon();
    const other = await seedSalon();

    // Someone from another salon.
    expect(
      await createService(scope, { ...braids, providerMembershipIds: [other.hanaMembership.id] }),
    ).toEqual({ ok: false, error: "provider_invalid" });

    // The owner here has no professional profile, so she does not serve customers.
    const [ownerMembership] = await db
      .select()
      .from(memberships)
      .where(eq(memberships.id, salon.membership.id));
    expect(
      await createService(scope, { ...braids, providerMembershipIds: [ownerMembership!.id] }),
    ).toEqual({ ok: false, error: "provider_invalid" });
  });

  it("stops a stylist changing services", async () => {
    const { scope, hanaScope } = await seedSalon();
    expect(await createService(hanaScope, braids)).toEqual({ ok: false, error: "forbidden" });

    const created = await createService(scope, braids);
    if (!created.ok) throw new Error(created.error);
    expect(await updateService(hanaScope, created.service.id, braids)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await setServiceArchived(hanaScope, created.service.id, true)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await moveService(hanaScope, created.service.id, "down")).toEqual({
      ok: false,
      error: "forbidden",
    });
    // She can still see the list.
    expect(await listServices(hanaScope)).toHaveLength(1);
  });

  it("updates a service and names price changes in the log", async () => {
    const { scope, hanaMembership } = await seedSalon();
    const created = await createService(scope, braids);
    if (!created.ok) throw new Error(created.error);
    const id = created.service.id;

    const renamed = await updateService(scope, id, {
      ...braids,
      name: "Braids",
      providerMembershipIds: [hanaMembership.id],
    });
    expect(renamed.ok && renamed.service.name).toBe("Braids");
    expect((await getService(scope, id))?.providerMembershipIds).toEqual([hanaMembership.id]);

    await updateService(scope, id, { ...braids, name: "Braids", priceStudio: 90_000 });
    // Leaving her unticked takes her off the service.
    expect((await getService(scope, id))?.providerMembershipIds).toEqual([]);

    const actions = (
      await db
        .select()
        .from(activityLog)
        .where(eq(activityLog.entityId, id))
        .orderBy(activityLog.createdAt)
    ).map((entry) => entry.action);
    expect(actions).toEqual(["service.created", "service.updated", "service.price_changed"]);
  });

  it("cannot reach another business's service", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    const created = await createService(theirs.scope, braids);
    if (!created.ok) throw new Error(created.error);
    const id = created.service.id;

    expect(await getService(mine.scope, id)).toBeNull();
    expect(await updateService(mine.scope, id, { ...braids, name: "Taken over" })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await setServiceArchived(mine.scope, id, true)).toEqual({
      ok: false,
      error: "not_found",
    });
    expect(await moveService(mine.scope, id, "up")).toEqual({ ok: false, error: "not_found" });

    const [untouched] = await db.select().from(services).where(eq(services.id, id));
    expect(untouched).toMatchObject({ name: "Shuruba (braids)", status: "active" });
  });

  it("archives, restores and reorders, and the public page follows", async () => {
    const { scope, slug } = await seedSalon();
    const names = ["Braids", "Wash", "Manicure"];
    const ids: string[] = [];
    for (const name of names) {
      const created = await createService(scope, { ...braids, name });
      if (!created.ok) throw new Error(created.error);
      ids.push(created.service.id);
    }
    const publicNames = async () =>
      (await loadPublicBusinessPage(slug))!.services.map((service) => service.name);
    expect(await publicNames()).toEqual(["Braids", "Wash", "Manicure"]);

    await moveService(scope, ids[2]!, "up");
    expect(await publicNames()).toEqual(["Braids", "Manicure", "Wash"]);
    // Moving the first one up changes nothing.
    await moveService(scope, ids[0]!, "up");
    expect(await publicNames()).toEqual(["Braids", "Manicure", "Wash"]);

    await setServiceArchived(scope, ids[0]!, true);
    expect(await publicNames()).toEqual(["Manicure", "Wash"]);
    expect((await listServices(scope)).map((service) => service.name)).toEqual(["Manicure", "Wash"]);
    expect(await listServices(scope, { includeArchived: true })).toHaveLength(3);

    await setServiceArchived(scope, ids[0]!, false);
    expect(await publicNames()).toEqual(["Braids", "Manicure", "Wash"]);
  });

  it("no longer counts someone who has left as performing a service", async () => {
    const { scope, hanaMembership } = await seedSalon();
    const created = await createService(scope, {
      ...braids,
      providerMembershipIds: [hanaMembership.id],
    });
    if (!created.ok) throw new Error(created.error);

    await db
      .update(memberships)
      .set({ status: "ended", endedAt: new Date() })
      .where(eq(memberships.id, hanaMembership.id));

    expect((await getService(scope, created.service.id))?.providerMembershipIds).toEqual([]);
  });
});

describe("services in a solo practice", () => {
  it("always has her as the one performing, and shows on her page", async () => {
    const user = await seedUser("Meron");
    const handle = `meron-${stamp()}`;
    const practice = await createIndependentPractice(user.id, {
      handle,
      displayName: "Meron Makeup",
      category: "makeup",
    });
    if (!practice.ok) throw new Error(practice.error);
    const scope = (await forBusiness(practice.business.id, user.id))!;

    const created = await createService(scope, {
      name: "Bridal makeup",
      durationMinutes: 120,
      bufferMinutes: 0,
      locationType: "both",
      priceStudio: 300_000,
      priceClientPlace: 350_000,
      providerMembershipIds: [],
    });
    if (!created.ok) throw new Error(created.error);

    const links = await db
      .select()
      .from(serviceProviders)
      .where(eq(serviceProviders.serviceId, created.service.id));
    expect(links.map((link) => link.membershipId)).toEqual([practice.membership.id]);

    const page = await loadPublicProfilePage(handle);
    const place = page?.places.find((p) => p.kind === "independent");
    expect(place?.kind === "independent" && place.services).toEqual([
      {
        id: created.service.id,
        name: "Bridal makeup",
        description: null,
        durationMinutes: 120,
        locationType: "both",
        priceStudio: 300_000,
        priceClientPlace: 350_000,
        currency: "ETB",
      },
    ]);
  });
});
