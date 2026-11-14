import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { activityLog, locations, memberships, subscriptions, users } from "@/db/schema";
import { createIndependentPractice, createSalon } from "./create";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import { getIndependentPractice, listHats, listMembershipsForUser } from "./queries";

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({
      displayName: label,
      email: `${label.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    })
    .returning();
  return user!;
}

describe("createIndependentPractice", () => {
  it("creates profile, business, default location and owner membership", async () => {
    const user = await seedUser("Meron Independent");
    const handle = `meron-${Date.now().toString(36)}`;

    const result = await createIndependentPractice(user.id, {
      handle,
      displayName: "Meron Hair",
      category: "hair",
      phone: "0911 23 45 67",
      addressText: "Bole, near Edna Mall",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.profile.handle).toBe(handle);
    expect(result.business.kind).toBe("independent");
    expect(result.business.slug).toBeNull();
    expect(result.business.phone).toBe("+251911234567");
    expect(result.location.isDefault).toBe(true);
    expect(result.location.addressPublic).toBe(false);
    expect(result.membership.role).toBe("owner");
    expect(result.membership.status).toBe("active");

    const listed = await listMembershipsForUser(user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.business.id).toBe(result.business.id);
  });

  it("rejects a second independent practice for the same person", async () => {
    const user = await seedUser("Second Independent");
    const base = Date.now().toString(36);

    const first = await createIndependentPractice(user.id, {
      handle: `first-${base}`,
      displayName: "First",
      category: "nails",
    });
    expect(first.ok).toBe(true);

    const second = await createIndependentPractice(user.id, {
      handle: `second-${base}`,
      displayName: "Second",
      category: "nails",
    });
    expect(second).toEqual({ ok: false, error: "already_has_independent" });
  });
});

describe("createSalon", () => {
  it("creates a salon with slug, default location and owner membership", async () => {
    const user = await seedUser("Salon Owner");
    const slug = `lounge-${Date.now().toString(36)}`;

    const result = await createSalon(user.id, {
      name: "Beauty Lounge",
      slug,
      category: "spa",
      locationName: "Bole",
      addressText: "Bole Road",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.business.kind).toBe("salon");
    expect(result.business.slug).toBe(slug);
    expect(result.location.name).toBe("Bole");
    expect(result.location.slug).toBe("bole");
    expect(result.membership.role).toBe("owner");

    const [stored] = await db
      .select()
      .from(locations)
      .where(eq(locations.businessId, result.business.id));
    expect(stored?.isDefault).toBe(true);
  });

  it("rejects a duplicate salon slug", async () => {
    const ownerA = await seedUser("Owner A");
    const ownerB = await seedUser("Owner B");
    const slug = `shared-${Date.now().toString(36)}`;

    const first = await createSalon(ownerA.id, {
      name: "First Salon",
      slug,
      category: "hair",
    });
    expect(first.ok).toBe(true);

    const second = await createSalon(ownerB.id, {
      name: "Second Salon",
      slug,
      category: "hair",
    });
    expect(second).toEqual({ ok: false, error: "slug_taken" });
  });

  it("lets one person own a salon and an independent practice", async () => {
    const user = await seedUser("Both Hats");
    const stamp = Date.now().toString(36);

    const independent = await createIndependentPractice(user.id, {
      handle: `both-${stamp}`,
      displayName: "Weekend Meron",
      category: "makeup",
    });
    expect(independent.ok).toBe(true);

    const salon = await createSalon(user.id, {
      name: "Weekday Salon",
      slug: `weekday-${stamp}`,
      category: "makeup",
    });
    expect(salon.ok).toBe(true);

    const listed = await listMembershipsForUser(user.id);
    expect(listed).toHaveLength(2);

    const kinds = listed.map((row) => row.business.kind).sort();
    expect(kinds).toEqual(["independent", "salon"]);
  });
});

describe("membership uniqueness", () => {
  it("allows only one non-ended membership per user per business", async () => {
    const user = await seedUser("Dup Member");
    const stamp = Date.now().toString(36);
    const created = await createSalon(user.id, {
      name: "Only Once",
      slug: `once-${stamp}`,
      category: "barber",
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    let code: string | undefined;
    try {
      await db.insert(memberships).values({
        businessId: created.business.id,
        userId: user.id,
        role: "stylist",
        status: "active",
      });
    } catch (error) {
      let current: unknown = error;
      while (current && typeof current === "object") {
        if ("code" in current && typeof (current as { code: unknown }).code === "string") {
          code = (current as { code: string }).code;
          if (code === "23505") break;
        }
        current = "cause" in current ? (current as { cause: unknown }).cause : null;
      }
    }
    expect(code).toBe("23505");

    // After ending the membership, a new one can be added.
    await db
      .update(memberships)
      .set({ status: "ended", endedAt: new Date(), endReason: "resigned" })
      .where(eq(memberships.id, created.membership.id));

    const [again] = await db
      .insert(memberships)
      .values({
        businessId: created.business.id,
        userId: user.id,
        role: "stylist",
        status: "active",
      })
      .returning();
    expect(again?.role).toBe("stylist");
  });
});

describe("records of creation", () => {
  it("logs the business and profile and starts the free plan in the same step", async () => {
    const user = await seedUser("Logged Meron");
    const result = await createIndependentPractice(user.id, {
      handle: `logged-${Date.now().toString(36)}`,
      displayName: "Logged Meron",
      category: "lashes",
    });
    if (!result.ok) throw new Error("expected ok");

    const entries = await db
      .select({ action: activityLog.action, businessId: activityLog.businessId })
      .from(activityLog)
      .where(eq(activityLog.actorUserId, user.id));
    expect(entries.map((e) => e.action).sort()).toEqual([
      "business.created",
      "professional_profile.created",
    ]);
    expect(entries.find((e) => e.action === "business.created")?.businessId).toBe(
      result.business.id,
    );

    const [subscription] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.businessId, result.business.id));
    expect(subscription?.planKey).toBe("individual_free");
  });

  it("logs a salon's creation with its address", async () => {
    const user = await seedUser("Logged Owner");
    const slug = `logged-${Date.now().toString(36)}`;
    const result = await createSalon(user.id, { name: "Logged Salon", slug, category: "hair" });
    if (!result.ok) throw new Error("expected ok");

    const [entry] = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.entityId, result.business.id));
    expect(entry?.action).toBe("business.created");
    expect(entry?.after).toEqual({ kind: "salon", name: "Logged Salon", slug });
  });

  it("leaves no log entry when creation fails", async () => {
    const ownerA = await seedUser("Taken A");
    const ownerB = await seedUser("Taken B");
    const slug = `taken-${Date.now().toString(36)}`;
    await createSalon(ownerA.id, { name: "First", slug, category: "hair" });

    expect(await createSalon(ownerB.id, { name: "Second", slug, category: "hair" })).toEqual({
      ok: false,
      error: "slug_taken",
    });
    const entries = await db
      .select()
      .from(activityLog)
      .where(eq(activityLog.actorUserId, ownerB.id));
    expect(entries).toHaveLength(0);
  });
});

describe("hats", () => {
  it("lists each place she can act in, with its public address", async () => {
    const user = await seedUser("Two Hats");
    const stamp = Date.now().toString(36);
    const independent = await createIndependentPractice(user.id, {
      handle: `hats-${stamp}`,
      displayName: "Hats Meron",
      category: "makeup",
    });
    const salon = await createSalon(user.id, {
      name: "Hats Salon",
      slug: `hats-salon-${stamp}`,
      category: "hair",
    });
    if (!independent.ok || !salon.ok) throw new Error("setup failed");

    const hats = await listHats(user.id);
    expect(hats).toEqual([
      {
        businessId: independent.business.id,
        name: "Hats Meron",
        kind: "independent",
        role: "owner",
        publicPath: `/@hats-${stamp}`,
      },
      {
        businessId: salon.business.id,
        name: "Hats Salon",
        kind: "salon",
        role: "owner",
        publicPath: `/hats-salon-${stamp}`,
      },
    ]);
    expect((await getIndependentPractice(user.id))?.id).toBe(independent.business.id);
  });

  it("leaves out ended, invited and requested memberships", async () => {
    const owner = await seedUser("Hat Owner");
    const stylist = await seedUser("Hat Stylist");
    const salon = await createSalon(owner.id, {
      name: "Hat Salon",
      slug: `hat-${Date.now().toString(36)}`,
      category: "hair",
    });
    if (!salon.ok) throw new Error("setup failed");

    for (const status of ["invited", "requested", "ended"] as const) {
      const [row] = await db
        .insert(memberships)
        .values({ businessId: salon.business.id, userId: stylist.id, role: "stylist", status })
        .returning();
      expect(await listHats(stylist.id)).toEqual([]);
      await db.delete(memberships).where(eq(memberships.id, row!.id));
    }
    expect(await getIndependentPractice(stylist.id)).toBeNull();
  });

  it("keeps a stylist's existing handle when she opens her own practice", async () => {
    const user = await seedUser("Weekend Hana");
    const handle = `hana-${Date.now().toString(36)}`;
    const profile = await createProfessionalProfile(user.id, { handle, displayName: "Hana" });
    if (!profile.ok) throw new Error("setup failed");

    const result = await createIndependentPractice(user.id, {
      handle,
      displayName: "Hana Weekend Visits",
      category: "hair",
    });
    if (!result.ok) throw new Error(`expected ok, got ${result.error}`);
    expect(result.profile.id).toBe(profile.profile.id);
    expect((await listHats(user.id))[0]?.publicPath).toBe(`/@${handle}`);
  });
});
