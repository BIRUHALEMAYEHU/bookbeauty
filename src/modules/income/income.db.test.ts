import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { memberships, users } from "@/db/schema";
import { forBusiness, type BusinessScope } from "@/db/scope";
import { formatMonth, zonedTimeToUtc } from "@/lib/time";
import { setWeeklyHours } from "@/modules/availability/hours";
import { holdSlot, loadBookingContext, submitBooking, type BookingContext } from "@/modules/booking/engine";
import { completeBooking, markNoShow } from "@/modules/booking/manage";
import { createSalon } from "@/modules/businesses/create";
import { createService } from "@/modules/catalog/services";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import { getIncome, isMonth, monthDays, shiftMonth } from "./income";

const TZ = "Africa/Addis_Ababa";

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `income-${stamp()}@example.com` })
    .returning();
  return user!;
}

/** A salon open every day with Hana and Meron, a braids and a wash service, and a receptionist. */
async function seedSalon() {
  const owner = await seedUser("Owner");
  const salon = await createSalon(owner.id, { name: "Income Salon", slug: `inc-${stamp()}`, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  const businessId = salon.business.id;
  const scope = (await forBusiness(businessId, owner.id))!;
  const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1080 }));
  const stylists = [];
  for (const name of ["Hana", "Meron"]) {
    const user = await seedUser(name);
    await createProfessionalProfile(user.id, { handle: `${name.toLowerCase()}-${stamp()}`, displayName: name });
    const [membership] = await db
      .insert(memberships)
      .values({ businessId, userId: user.id, role: "stylist" })
      .returning();
    await setWeeklyHours(scope, membership!.id, week);
    stylists.push({ user, membershipId: membership!.id });
  }
  const desk = await seedUser("Desk");
  await db.insert(memberships).values({ businessId, userId: desk.id, role: "receptionist" });
  const ids = stylists.map((stylist) => stylist.membershipId);
  const contexts: Record<string, BookingContext> = {};
  for (const [name, price] of [["Braids", 80_000], ["Wash", 35_000]] as const) {
    const service = await createService(scope, {
      name,
      durationMinutes: 60,
      bufferMinutes: 0,
      locationType: "studio",
      priceStudio: price,
      priceClientPlace: null,
      providerMembershipIds: ids,
    });
    if (!service.ok) throw new Error(service.error);
    contexts[name] = (await loadBookingContext(businessId, service.service.id))!;
  }
  const [hana, meron] = stylists as [(typeof stylists)[0], (typeof stylists)[0]];
  return {
    scope,
    hana,
    meron,
    contexts,
    hanaScope: (await forBusiness(businessId, hana.user.id))!,
    deskScope: (await forBusiness(businessId, desk.id))!,
  };
}

/** A visit on a given day at 9:00 AM, booked the day before, then closed. */
async function visit(
  scope: BusinessScope,
  context: BookingContext,
  membershipId: string,
  date: string,
  close: { amount: number; method: string } | "no_show" | null,
  minute = 540,
) {
  const startsAt = zonedTimeToUtc(date, minute, TZ);
  const before = new Date(startsAt.getTime() - 24 * 60 * 60_000);
  const held = await holdSlot(context, { startsAt, membershipId, atClientPlace: false, source: "business_page", now: before });
  if (!held.ok) throw new Error(held.error);
  const done = await submitBooking(held.token, { name: "Tigist", phone: uniquePhone() }, before);
  if (!done.ok) throw new Error(done.error);
  const after = new Date(startsAt.getTime() + 60 * 60_000);
  if (close === "no_show") await markNoShow(scope, held.bookingId, after);
  else if (close) await completeBooking(scope, held.bookingId, { amountPaid: close.amount, method: close.method }, after);
  return held.bookingId;
}

describe("months", () => {
  it("steps across years and knows each month's days", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(monthDays("2026-02")).toEqual({ first: "2026-02-01", last: "2026-02-28" });
    expect(monthDays("2028-02").last).toBe("2028-02-29");
    expect(isMonth("2026-11")).toBe(true);
    expect(isMonth("2026-13")).toBe(false);
    expect(formatMonth("2026-11")).toBe("November 2026");
  });
});

describe("the income tracker (F25)", () => {
  it("adds up completed visits in the month by the day of the visit", async () => {
    const { scope, contexts, hana, meron } = await seedSalon();
    const braids = contexts.Braids!;
    const wash = contexts.Wash!;
    await visit(scope, braids, hana.membershipId, "2026-10-05", { amount: 80_000, method: "cash" });
    await visit(scope, wash, meron.membershipId, "2026-10-06", { amount: 30_000, method: "telebirr" });
    await visit(scope, braids, meron.membershipId, "2026-10-31", { amount: 90_000, method: "telebirr" }, 1020);
    // Not income: a no-show, a visit not closed yet, and one in the next month.
    await visit(scope, wash, hana.membershipId, "2026-10-07", "no_show");
    await visit(scope, wash, hana.membershipId, "2026-10-08", null);
    await visit(scope, braids, hana.membershipId, "2026-11-01", { amount: 80_000, method: "cash" });

    const october = (await getIncome(scope, "2026-10"))!;
    expect(october).toMatchObject({ total: 200_000, visits: 3, average: 66_667, currency: "ETB", ownOnly: false });
    expect(october.byMethod.map((line) => [line.key, line.amount, line.visits])).toEqual([
      ["telebirr", 120_000, 2],
      ["cash", 80_000, 1],
    ]);
    expect(october.byService.map((line) => [line.label, line.amount])).toEqual([
      ["Braids", 170_000],
      ["Wash", 30_000],
    ]);
    expect(october.byProfessional.map((line) => [line.label, line.amount])).toEqual([
      ["Meron", 120_000],
      ["Hana", 80_000],
    ]);
    // Newest first; 5:00 PM on 31 October (local) still counts for October.
    expect(october.entries[0]).toMatchObject({ serviceName: "Braids", amountPaid: 90_000, professionalName: "Meron" });
    expect((await getIncome(scope, "2026-11"))!.total).toBe(80_000);
  });

  it("shows a stylist only her own visits, and the front desk nothing", async () => {
    const { scope, contexts, hana, meron, hanaScope, deskScope } = await seedSalon();
    await visit(scope, contexts.Braids!, hana.membershipId, "2026-10-05", { amount: 80_000, method: "cash" });
    await visit(scope, contexts.Wash!, meron.membershipId, "2026-10-05", { amount: 35_000, method: "cash" });

    const own = (await getIncome(hanaScope, "2026-10"))!;
    expect(own).toMatchObject({ total: 80_000, visits: 1, ownOnly: true, byProfessional: [] });
    expect(await getIncome(deskScope, "2026-10")).toBeNull();
  });

  it("never counts another business's income", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    await visit(theirs.scope, theirs.contexts.Braids!, theirs.hana.membershipId, "2026-10-05", {
      amount: 80_000,
      method: "cash",
    });
    expect((await getIncome(mine.scope, "2026-10"))!.total).toBe(0);
  });
});
