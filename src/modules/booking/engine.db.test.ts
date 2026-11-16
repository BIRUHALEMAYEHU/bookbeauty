import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import {
  appointments,
  bookings,
  businesses,
  customerRecords,
  memberships,
  services,
  users,
} from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { formatTime, zonedTimeToUtc } from "@/lib/time";
import { setTravelBuffer, setWeeklyHours } from "@/modules/availability/hours";
import { createIndependentPractice, createSalon } from "@/modules/businesses/create";
import { createService } from "@/modules/catalog/services";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import {
  cancelByGuest,
  expireStaleHolds,
  getGuestBooking,
  getOpenSlots,
  holdSlot,
  loadBookingContext,
  submitBooking,
  type BookingContext,
} from "./engine";

const TZ = "Africa/Addis_Ababa";
// "Now" is Monday 16 November 2026, 9:00 AM in Addis. Everyone below works Tuesdays 9:00 AM to 12:00 PM.
const now = zonedTimeToUtc("2026-11-16", 540, TZ);
const TUESDAY = "2026-11-17";
const tuesdayAt = (minutes: number) => zonedTimeToUtc(TUESDAY, minutes, TZ);
const TUESDAY_HOURS = [{ weekday: 2, startMinute: 540, endMinute: 720 }];

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `booking-${stamp()}@example.com` })
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

/** A salon with Hana and Meron, both working Tuesday mornings, and a one-hour service they both do. */
async function seedSalon() {
  const owner = await seedUser("Owner");
  const salon = await createSalon(owner.id, { name: "Booking Salon", slug: `book-${stamp()}`, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  const businessId = salon.business.id;
  const hana = await addStylist(businessId, "Hana");
  const meron = await addStylist(businessId, "Meron");
  const scope = (await forBusiness(businessId, owner.id))!;
  for (const stylist of [hana, meron]) {
    const saved = await setWeeklyHours(scope, stylist.membershipId, TUESDAY_HOURS);
    if (!saved.ok) throw new Error(saved.error);
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
  const context = (await loadBookingContext(businessId, service.service.id))!;
  return { businessId, scope, hana, meron, serviceId: service.service.id, context };
}

const hold = (context: BookingContext, minutes: number, membershipId: string | null) =>
  holdSlot(context, {
    startsAt: tuesdayAt(minutes),
    membershipId,
    atClientPlace: false,
    source: "business_page",
    now,
  });

const guest = { name: "Tigist Alemu", phone: "0911 22 33 44" };
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function slotTimes(context: BookingContext, membershipId: string | null, at = now) {
  const slots = await getOpenSlots(context, { date: TUESDAY, membershipId, atClientPlace: false, now: at });
  return slots.map((slot) => formatTime(slot.startsAt, TZ));
}

describe("holding a time", () => {
  it("offers her open times and takes one out when it is held", async () => {
    const { context, hana } = await seedSalon();
    expect(await slotTimes(context, hana.membershipId)).toEqual([
      "9:00 AM", "9:15 AM", "9:30 AM", "9:45 AM", "10:00 AM", "10:15 AM", "10:30 AM", "10:45 AM", "11:00 AM",
    ]);

    const held = await hold(context, 600, hana.membershipId); // 10:00 to 11:00 AM
    expect(held.ok).toBe(true);
    if (!held.ok) return;
    expect(held.holdExpiresAt.getTime() - now.getTime()).toBe(10 * 60_000);
    expect(await slotTimes(context, hana.membershipId)).toEqual(["9:00 AM", "11:00 AM"]);

    const view = await getGuestBooking(held.token, now);
    expect(view).toMatchObject({
      status: "held",
      serviceName: "Wash and blow-dry",
      professionalName: "Hana",
      totalPrice: 35_000,
      canCancel: false,
    });
  });

  it("refuses a time that is not on offer", async () => {
    const { context, hana } = await seedSalon();
    // 2:00 PM is outside her hours; 9:07 AM is not on the quarter hour.
    expect(await hold(context, 840, hana.membershipId)).toEqual({ ok: false, error: "not_available" });
    expect(await hold(context, 547, hana.membershipId)).toEqual({ ok: false, error: "not_available" });
    // The service is not offered at the customer's place.
    expect(
      await holdSlot(context, {
        startsAt: tuesdayAt(600),
        membershipId: hana.membershipId,
        atClientPlace: true,
        source: "business_page",
        now,
      }),
    ).toEqual({ ok: false, error: "not_available" });
    // Someone who does not perform this service here.
    expect(await hold(context, 600, "018f0000-0000-7000-8000-000000000000")).toEqual({
      ok: false,
      error: "not_available",
    });
  });

  it("lets exactly one of many simultaneous customers have a slot (Appendix D.2)", async () => {
    const { context, hana } = await seedSalon();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => hold(context, 600, hana.membershipId)),
    );
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toHaveLength(11);

    const active = await db
      .select()
      .from(appointments)
      .where(and(eq(appointments.professionalUserId, hana.user.id), eq(appointments.status, "active")));
    expect(active).toHaveLength(1);
  });

  it("the database itself refuses an overlapping appointment, whatever the code does", async () => {
    const { context, hana } = await seedSalon();
    const held = await hold(context, 600, hana.membershipId);
    if (!held.ok) throw new Error(held.error);

    const overlapping = db.insert(appointments).values({
      bookingId: held.bookingId,
      businessId: context.business.id,
      serviceId: context.service.id,
      membershipId: hana.membershipId,
      professionalUserId: hana.user.id,
      assignment: "manual",
      startsAt: tuesdayAt(630),
      endsAt: tuesdayAt(690),
      blockedUntil: tuesdayAt(690),
      price: 0,
    });
    await expect(overlapping).rejects.toThrow();
  });
});

describe("any available (D84, D98)", () => {
  it("shares bookings between free professionals, then runs out", async () => {
    const { context, hana, meron } = await seedSalon();
    const first = await hold(context, 600, null);
    const second = await hold(context, 600, null);
    const third = await hold(context, 600, null);
    expect(first.ok && second.ok).toBe(true);
    // Both are taken by the time the third customer asks.
    expect(third).toEqual({ ok: false, error: "not_available" });

    const taken = await db
      .select({ userId: appointments.professionalUserId, assignment: appointments.assignment })
      .from(appointments)
      .where(eq(appointments.businessId, context.business.id));
    expect(taken.map((row) => row.userId).sort()).toEqual([hana.user.id, meron.user.id].sort());
    expect(taken.every((row) => row.assignment === "auto")).toBe(true);

    // The customer is not told who was picked.
    if (first.ok) expect((await getGuestBooking(first.token, now))?.professionalName).toBeNull();
  });

  it("gives the next booking to whoever has fewer that day", async () => {
    const { context, hana, meron } = await seedSalon();
    // Hana already has 9:00 AM. A new "any available" booking at 11:00 AM goes to Meron.
    await hold(context, 540, hana.membershipId);
    const held = await hold(context, 660, null);
    if (!held.ok) throw new Error(held.error);
    const [row] = await db.select().from(appointments).where(eq(appointments.bookingId, held.bookingId));
    expect(row?.professionalUserId).toBe(meron.user.id);
  });

  it("gives every racing customer a professional until none are left", async () => {
    const { context } = await seedSalon();
    const results = await Promise.all(Array.from({ length: 8 }, () => hold(context, 600, null)));
    expect(results.filter((result) => result.ok)).toHaveLength(2);
  });
});

describe("one person, two places", () => {
  it("a booking at the salon blocks the same time in her own practice", async () => {
    const { context, hana } = await seedSalon();
    const practice = await createIndependentPractice(hana.user.id, {
      handle: `hana-own-${stamp()}`,
      displayName: "Hana",
      category: "hair",
    });
    // She already has a profile from the salon; the practice reuses it.
    if (!practice.ok) throw new Error(practice.error);
    const scope = (await forBusiness(practice.business.id, hana.user.id))!;
    await setWeeklyHours(scope, practice.membership.id, TUESDAY_HOURS);
    const service = await createService(scope, {
      name: "Home styling",
      durationMinutes: 60,
      bufferMinutes: 0,
      locationType: "studio",
      priceStudio: 50_000,
      priceClientPlace: null,
      providerMembershipIds: [],
    });
    if (!service.ok) throw new Error(service.error);
    const own = (await loadBookingContext(practice.business.id, service.service.id))!;

    expect(await slotTimes(own, null)).toContain("10:00 AM");
    const atSalon = await hold(context, 600, hana.membershipId);
    expect(atSalon.ok).toBe(true);

    expect(await slotTimes(own, null)).toEqual(["9:00 AM", "11:00 AM"]);
    expect(await hold(own, 600, null)).toEqual({ ok: false, error: "not_available" });
  });
});

describe("holds run out", () => {
  it("frees the time after ten minutes, and the late customer is told", async () => {
    const { context, hana } = await seedSalon();
    const held = await hold(context, 600, hana.membershipId);
    if (!held.ok) throw new Error(held.error);

    const later = new Date(now.getTime() + 11 * 60_000);
    // Free again for others even before anything tidies the hold away.
    expect(await slotTimes(context, hana.membershipId, later)).toContain("10:00 AM");
    expect((await getGuestBooking(held.token, later))?.status).toBe("expired");
    expect(await submitBooking(held.token, guest, later)).toEqual({ ok: false, error: "expired" });

    // Someone else can now take it.
    const next = await holdSlot(context, {
      startsAt: tuesdayAt(600),
      membershipId: hana.membershipId,
      atClientPlace: false,
      source: "business_page",
      now: later,
    });
    expect(next.ok).toBe(true);
    const [old] = await db.select().from(bookings).where(eq(bookings.id, held.bookingId));
    expect(old?.status).toBe("expired");
    expect(await expireStaleHolds(context.business.id, later)).toBe(0);
  });
});

describe("giving her details", () => {
  it("confirms the booking and starts a customer record", async () => {
    const { context, hana, businessId } = await seedSalon();
    const held = await hold(context, 600, hana.membershipId);
    if (!held.ok) throw new Error(held.error);

    const result = await submitBooking(
      held.token,
      { ...guest, email: "tigist@example.com", notes: "First visit", allergies: "Latex" },
      now,
    );
    // Only the outcome comes back: nothing about any record (D91).
    expect(result).toEqual({ ok: true, status: "confirmed" });

    const [record] = await db.select().from(customerRecords).where(eq(customerRecords.businessId, businessId));
    expect(record).toMatchObject({
      name: "Tigist Alemu",
      phone: "+251911223344",
      email: "tigist@example.com",
      allergies: "Latex",
    });
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, held.bookingId));
    expect(booking).toMatchObject({
      status: "confirmed",
      customerRecordId: record!.id,
      customerName: "Tigist Alemu",
      customerPhone: "+251911223344",
      customerNotes: "First visit",
      holdExpiresAt: null,
    });

    const view = await getGuestBooking(held.token, now);
    expect(view).toMatchObject({ status: "confirmed", canCancel: true });
    // Giving details twice does nothing.
    expect(await submitBooking(held.token, guest, now)).toEqual({ ok: false, error: "expired" });
  });

  it("attaches a second booking to the same record by phone, without overwriting it (D92)", async () => {
    const { context, hana, businessId } = await seedSalon();
    const phone = uniquePhone();
    const first = await hold(context, 540, hana.membershipId);
    const second = await hold(context, 660, hana.membershipId);
    if (!first.ok || !second.ok) throw new Error("setup failed");

    await submitBooking(first.token, { name: "Tigist Alemu", phone, allergies: "Latex" }, now);
    // Her sister books with the same phone, written differently.
    await submitBooking(
      second.token,
      { name: "Sara Alemu", phone: `+251${phone.slice(1)}`, allergies: "Ammonia" },
      now,
    );

    const records = await db.select().from(customerRecords).where(eq(customerRecords.businessId, businessId));
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ name: "Tigist Alemu", allergies: "Latex\nAmmonia" });

    const [later] = await db.select().from(bookings).where(eq(bookings.id, second.bookingId));
    expect(later).toMatchObject({ customerName: "Sara Alemu", customerRecordId: records[0]!.id });
  });

  it("keeps each business's customers separate", async () => {
    const a = await seedSalon();
    const b = await seedSalon();
    const phone = uniquePhone();
    const atA = await hold(a.context, 600, a.hana.membershipId);
    const atB = await hold(b.context, 600, b.hana.membershipId);
    if (!atA.ok || !atB.ok) throw new Error("setup failed");
    await submitBooking(atA.token, { name: "Liya", phone }, now);
    await submitBooking(atB.token, { name: "Liya", phone }, now);

    const [recordA] = await db.select().from(customerRecords).where(eq(customerRecords.businessId, a.businessId));
    const [recordB] = await db.select().from(customerRecords).where(eq(customerRecords.businessId, b.businessId));
    expect(recordA?.id).not.toBe(recordB?.id);
  });

  it("rejects details that cannot be used", async () => {
    const { context, hana } = await seedSalon();
    const held = await hold(context, 600, hana.membershipId);
    if (!held.ok) throw new Error(held.error);

    expect(await submitBooking(held.token, { name: "T", phone: "0911223344" }, now)).toEqual({
      ok: false,
      error: "invalid_input",
    });
    // A landline cannot be a customer's number: it is the matching key (D106).
    expect(await submitBooking(held.token, { name: "Tigist", phone: "011 123 4567" }, now)).toEqual({
      ok: false,
      error: "phone_invalid",
    });
    expect(
      await submitBooking(held.token, { name: "Tigist", phone: "0911223344", email: "not-an-email" }, now),
    ).toEqual({ ok: false, error: "invalid_input" });
    expect(await submitBooking("f".repeat(64), guest, now)).toEqual({ ok: false, error: "not_found" });
    // The hold is still hers after the mistakes.
    expect((await submitBooking(held.token, guest, now)).ok).toBe(true);
  });
});

describe("approval mode (F16)", () => {
  it("waits for approval when the business asks for it, unless the service says otherwise", async () => {
    const { context, hana, businessId, serviceId } = await seedSalon();
    await db.update(businesses).set({ approvalMode: "manual" }).where(eq(businesses.id, businessId));

    const first = await hold(context, 540, hana.membershipId);
    if (!first.ok) throw new Error(first.error);
    expect(await submitBooking(first.token, { name: "Liya", phone: uniquePhone() }, now)).toEqual({
      ok: true,
      status: "pending_approval",
    });
    // A request still keeps the time: nobody else can take it while she waits.
    expect(await slotTimes(context, hana.membershipId)).not.toContain("9:00 AM");

    await db.update(services).set({ requiresApproval: false }).where(eq(services.id, serviceId));
    const second = await hold(context, 660, hana.membershipId);
    if (!second.ok) throw new Error(second.error);
    expect(await submitBooking(second.token, { name: "Liya", phone: uniquePhone() }, now)).toEqual({
      ok: true,
      status: "confirmed",
    });
  });
});

describe("a visit to the customer's place (F17, F18)", () => {
  it("needs an address, uses that price, and blocks her travel time afterwards", async () => {
    const user = await seedUser("Meron");
    const practice = await createIndependentPractice(user.id, {
      handle: `meron-${stamp()}`,
      displayName: "Meron",
      category: "makeup",
    });
    if (!practice.ok) throw new Error(practice.error);
    const scope = (await forBusiness(practice.business.id, user.id))!;
    await setWeeklyHours(scope, practice.membership.id, [{ weekday: 2, startMinute: 540, endMinute: 900 }]);
    await setTravelBuffer(scope, practice.membership.id, 45);
    const service = await createService(scope, {
      name: "Bridal makeup",
      durationMinutes: 60,
      bufferMinutes: 15,
      locationType: "both",
      priceStudio: 300_000,
      priceClientPlace: 350_000,
      providerMembershipIds: [],
    });
    if (!service.ok) throw new Error(service.error);
    const context = (await loadBookingContext(practice.business.id, service.service.id))!;

    const held = await holdSlot(context, {
      startsAt: tuesdayAt(600),
      membershipId: null,
      atClientPlace: true,
      source: "professional_page",
      now,
    });
    if (!held.ok) throw new Error(held.error);

    const [appointment] = await db.select().from(appointments).where(eq(appointments.bookingId, held.bookingId));
    expect(appointment?.price).toBe(350_000);
    // 10:00 to 11:00 AM, then 15 minutes free and 45 minutes of travel: blocked until 12:00 PM.
    expect(appointment?.blockedUntil).toEqual(tuesdayAt(720));
    const open = await getOpenSlots(context, { date: TUESDAY, membershipId: null, atClientPlace: false, now });
    // Nothing fits before the visit (9:00 AM plus its 15 free minutes would run into it).
    expect(open.map((slot) => formatTime(slot.startsAt, TZ))).toEqual([
      "12:00 PM", "12:15 PM", "12:30 PM", "12:45 PM", "1:00 PM", "1:15 PM", "1:30 PM", "1:45 PM", "2:00 PM",
    ]);

    expect(await submitBooking(held.token, { name: "Sara", phone: uniquePhone() }, now)).toEqual({
      ok: false,
      error: "address_required",
    });
    expect(
      await submitBooking(
        held.token,
        { name: "Sara", phone: uniquePhone(), addressText: "CMC, behind St. Michael church" },
        now,
      ),
    ).toEqual({ ok: true, status: "confirmed" });
    const [booking] = await db.select().from(bookings).where(eq(bookings.id, held.bookingId));
    expect(booking).toMatchObject({
      atClientPlace: true,
      clientAddressText: "CMC, behind St. Michael church",
      totalPrice: 350_000,
      source: "professional_page",
    });
  });
});

describe("cancelling from her link (D104)", () => {
  it("frees the time, counts the cancellation, and stops two hours before", async () => {
    const { context, hana, businessId } = await seedSalon();
    const held = await hold(context, 600, hana.membershipId);
    if (!held.ok) throw new Error(held.error);
    await submitBooking(held.token, { name: "Liya", phone: uniquePhone() }, now);

    // 8:30 AM on the day: an hour and a half before a 10:00 AM start is too late.
    const tooLate = tuesdayAt(510);
    expect((await getGuestBooking(held.token, tooLate))?.canCancel).toBe(false);
    expect(await cancelByGuest(held.token, tooLate)).toEqual({ ok: false, error: "too_late" });

    expect(await cancelByGuest(held.token, now)).toEqual({ ok: true });
    expect(await getGuestBooking(held.token, now)).toMatchObject({
      status: "cancelled",
      cancelledBy: "customer",
      canCancel: false,
    });
    expect(await slotTimes(context, hana.membershipId)).toContain("10:00 AM");
    const [record] = await db.select().from(customerRecords).where(eq(customerRecords.businessId, businessId));
    expect(record?.cancellationCount).toBe(1);

    expect(await cancelByGuest(held.token, now)).toEqual({ ok: false, error: "too_late" });
    expect(await cancelByGuest("0".repeat(64), now)).toEqual({ ok: false, error: "not_found" });
  });

  it("lets her give up a hold straight away", async () => {
    const { context, hana } = await seedSalon();
    const held = await hold(context, 600, hana.membershipId);
    if (!held.ok) throw new Error(held.error);
    expect(await cancelByGuest(held.token, now)).toEqual({ ok: true });
    expect(await slotTimes(context, hana.membershipId)).toContain("10:00 AM");
    expect((await getGuestBooking(held.token, now))?.status).toBe("expired");
  });
});
