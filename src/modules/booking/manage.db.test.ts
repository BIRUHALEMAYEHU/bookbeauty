import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { activityLog, bookings, businesses, memberships, users } from "@/db/schema";
import { forBusiness, type BusinessScope } from "@/db/scope";
import { formatTime, zonedTimeToUtc } from "@/lib/time";
import { setWeeklyHours } from "@/modules/availability/hours";
import { createSalon } from "@/modules/businesses/create";
import { createService } from "@/modules/catalog/services";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import {
  getGuestBooking,
  getOpenSlots,
  holdSlot,
  loadBookingContext,
  submitBooking,
  type BookingContext,
} from "./engine";
import {
  approveBooking,
  cancelBookingByBusiness,
  listUpcomingBookings,
  setApprovalMode,
} from "./manage";

const TZ = "Africa/Addis_Ababa";
// "Now" is Monday 16 November 2026, 9:00 AM in Addis; everyone works Tuesday 9:00 AM to 12:00 PM.
const now = zonedTimeToUtc("2026-11-16", 540, TZ);
const startOfToday = zonedTimeToUtc("2026-11-16", 0, TZ);
const TUESDAY = "2026-11-17";
const tuesdayAt = (minutes: number) => zonedTimeToUtc(TUESDAY, minutes, TZ);

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `manage-${stamp()}@example.com` })
    .returning();
  return user!;
}

async function addStylist(businessId: string, name: string) {
  const user = await seedUser(name);
  await createProfessionalProfile(user.id, { handle: `${name.toLowerCase()}-${stamp()}`, displayName: name });
  const [membership] = await db
    .insert(memberships)
    .values({ businessId, userId: user.id, role: "stylist" })
    .returning();
  return { user, membershipId: membership!.id };
}

/** A salon that approves each booking, with Hana and Meron working Tuesday mornings. */
async function seedSalon() {
  const owner = await seedUser("Owner");
  const salon = await createSalon(owner.id, { name: "Manage Salon", slug: `manage-${stamp()}`, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  const businessId = salon.business.id;
  const hana = await addStylist(businessId, "Hana");
  const meron = await addStylist(businessId, "Meron");
  const scope = (await forBusiness(businessId, owner.id))!;
  for (const stylist of [hana, meron]) {
    await setWeeklyHours(scope, stylist.membershipId, [{ weekday: 2, startMinute: 540, endMinute: 720 }]);
  }
  const service = await createService(scope, {
    name: "Wash and blow-dry",
    durationMinutes: 60,
    bufferMinutes: 0,
    locationType: "studio",
    priceStudio: 35_000,
    priceClientPlace: null,
    providerMembershipIds: [hana.membershipId, meron.membershipId],
  });
  if (!service.ok) throw new Error(service.error);
  expect(await setApprovalMode(scope, "manual")).toEqual({ ok: true });
  const context = (await loadBookingContext(businessId, service.service.id))!;
  return {
    businessId,
    scope,
    hana,
    meron,
    context,
    hanaScope: (await forBusiness(businessId, hana.user.id))!,
    meronScope: (await forBusiness(businessId, meron.user.id))!,
  };
}

/** A customer books a time with one of the stylists; returns her link's secret and the booking id. */
async function book(context: BookingContext, minutes: number, membershipId: string, name = "Tigist") {
  const held = await holdSlot(context, {
    startsAt: tuesdayAt(minutes),
    membershipId,
    atClientPlace: false,
    source: "business_page",
    now,
  });
  if (!held.ok) throw new Error(held.error);
  const submitted = await submitBooking(
    held.token,
    { name, phone: uniquePhone(), allergies: "Latex", notes: "First visit" },
    now,
  );
  if (!submitted.ok) throw new Error(submitted.error);
  return { token: held.token, id: held.bookingId, status: submitted.status };
}

const list = (scope: BusinessScope, at = now) => listUpcomingBookings(scope, startOfToday, at);

async function openTimes(context: BookingContext, membershipId: string) {
  const slots = await getOpenSlots(context, { date: TUESDAY, membershipId, atClientPlace: false, now });
  return slots.map((slot) => formatTime(slot.startsAt, TZ));
}

describe("seeing bookings", () => {
  it("shows the owner everything, soonest first, with what staff need to know", async () => {
    const { scope, context, hana, meron } = await seedSalon();
    await book(context, 660, meron.membershipId, "Liya");
    await book(context, 540, hana.membershipId, "Tigist");

    const rows = await list(scope);
    expect(rows.map((row) => row.customerName)).toEqual(["Tigist", "Liya"]);
    expect(rows[0]).toMatchObject({
      status: "pending_approval",
      serviceName: "Wash and blow-dry",
      professionalName: "Hana",
      assignment: "requested",
      allergies: "Latex",
      customerNotes: "First visit",
      totalPrice: 35_000,
      atClientPlace: false,
    });
    expect(rows[0]?.startsAt).toEqual(tuesdayAt(540));
    expect(rows[0]?.customerPhone).toMatch(/^\+2519\d{8}$/);
  });

  it("shows a stylist only her own", async () => {
    const { context, hana, meron, hanaScope, meronScope } = await seedSalon();
    await book(context, 540, hana.membershipId, "Tigist");
    await book(context, 540, meron.membershipId, "Liya");
    expect((await list(hanaScope)).map((row) => row.customerName)).toEqual(["Tigist"]);
    expect((await list(meronScope)).map((row) => row.customerName)).toEqual(["Liya"]);
  });

  it("leaves out holds, cancelled bookings and other businesses", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    await book(theirs.context, 540, theirs.hana.membershipId);
    // A hold nobody finished.
    await holdSlot(mine.context, {
      startsAt: tuesdayAt(540),
      membershipId: mine.hana.membershipId,
      atClientPlace: false,
      source: "business_page",
      now,
    });
    const cancelled = await book(mine.context, 660, mine.hana.membershipId);
    await cancelBookingByBusiness(mine.scope, cancelled.id, undefined, now);
    expect(await list(mine.scope)).toEqual([]);
    expect(await list(theirs.scope)).toHaveLength(1);
  });
});

describe("approving and declining (F16)", () => {
  it("approves a request, once, and records who did", async () => {
    const { scope, context, hana } = await seedSalon();
    const booking = await book(context, 540, hana.membershipId);
    expect(booking.status).toBe("pending_approval");

    expect(await approveBooking(scope, booking.id, now)).toEqual({ ok: true });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row).toMatchObject({ status: "confirmed", approvedByUserId: scope.actor.userId });
    expect(row?.approvedAt).toEqual(now);
    expect((await getGuestBooking(booking.token, now))?.status).toBe("confirmed");

    expect(await approveBooking(scope, booking.id, now)).toEqual({ ok: false, error: "wrong_status" });
    const logged = await db.select().from(activityLog).where(eq(activityLog.entityId, booking.id));
    expect(logged.map((entry) => entry.action)).toContain("booking.approved");
  });

  it("declining frees the time and tells the customer on her link", async () => {
    const { scope, context, hana } = await seedSalon();
    const booking = await book(context, 540, hana.membershipId);
    expect(await openTimes(context, hana.membershipId)).not.toContain("9:00 AM");

    expect(await cancelBookingByBusiness(scope, booking.id, "Fully booked that day", now)).toEqual({
      ok: true,
    });
    expect(await openTimes(context, hana.membershipId)).toContain("9:00 AM");
    expect(await getGuestBooking(booking.token, now)).toMatchObject({
      status: "cancelled",
      cancelledBy: "business",
      canCancel: false,
    });
    expect(await approveBooking(scope, booking.id, now)).toEqual({ ok: false, error: "wrong_status" });
    expect(await cancelBookingByBusiness(scope, booking.id, undefined, now)).toEqual({
      ok: false,
      error: "wrong_status",
    });
  });

  it("lets a stylist answer her own requests but not a colleague's", async () => {
    const { context, hana, meron, hanaScope } = await seedSalon();
    const own = await book(context, 540, hana.membershipId);
    const other = await book(context, 540, meron.membershipId);

    expect(await approveBooking(hanaScope, other.id, now)).toEqual({ ok: false, error: "forbidden" });
    expect(await cancelBookingByBusiness(hanaScope, other.id, undefined, now)).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await approveBooking(hanaScope, own.id, now)).toEqual({ ok: true });
  });

  it("cannot touch another business's booking", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    const booking = await book(theirs.context, 540, theirs.hana.membershipId);

    expect(await approveBooking(mine.scope, booking.id, now)).toEqual({ ok: false, error: "not_found" });
    expect(await cancelBookingByBusiness(mine.scope, booking.id, undefined, now)).toEqual({
      ok: false,
      error: "not_found",
    });
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row?.status).toBe("pending_approval");
  });

  it("lets a request lapse when nobody answers before its start", async () => {
    const { scope, context, hana } = await seedSalon();
    const booking = await book(context, 540, hana.membershipId);

    const afterStart = tuesdayAt(600);
    expect(await list(scope, afterStart)).toEqual([]);
    const [row] = await db.select().from(bookings).where(eq(bookings.id, booking.id));
    expect(row).toMatchObject({ status: "expired", cancelledBy: "system" });
    expect(await approveBooking(scope, booking.id, afterStart)).toEqual({
      ok: false,
      error: "wrong_status",
    });
  });
});

describe("cancelling a confirmed visit", () => {
  it("frees the time and is logged", async () => {
    const { scope, context, hana } = await seedSalon();
    const booking = await book(context, 540, hana.membershipId);
    await approveBooking(scope, booking.id, now);

    expect(await cancelBookingByBusiness(scope, booking.id, undefined, now)).toEqual({ ok: true });
    expect(await openTimes(context, hana.membershipId)).toContain("9:00 AM");
    const logged = await db.select().from(activityLog).where(eq(activityLog.entityId, booking.id));
    expect(logged.map((entry) => entry.action)).toContain("booking.cancelled_by_business");
  });
});

describe("the approval setting", () => {
  it("is the owner's to change, and decides how the next booking lands", async () => {
    const { scope, hanaScope, context, hana, businessId } = await seedSalon();
    expect(await setApprovalMode(hanaScope, "auto")).toEqual({ ok: false, error: "forbidden" });

    expect(await setApprovalMode(scope, "auto")).toEqual({ ok: true });
    const [business] = await db.select().from(businesses).where(eq(businesses.id, businessId));
    expect(business?.approvalMode).toBe("auto");
    expect((await book(context, 540, hana.membershipId)).status).toBe("confirmed");
  });
});
