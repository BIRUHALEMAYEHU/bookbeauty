import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db/client";
import { bookings, customerRecords, memberships, users } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { zonedTimeToUtc } from "@/lib/time";
import { setWeeklyHours } from "@/modules/availability/hours";
import { holdSlot, loadBookingContext, submitBooking, type BookingContext } from "@/modules/booking/engine";
import { completeBooking, markNoShow } from "@/modules/booking/manage";
import { createSalon } from "@/modules/businesses/create";
import { createService } from "@/modules/catalog/services";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import {
  addNote,
  deleteNote,
  getCustomer,
  listCustomers,
  splitCustomer,
  updateCustomer,
} from "./records";

const TZ = "Africa/Addis_Ababa";
// "Now" is Monday 16 November 2026, 7:00 AM in Addis; visits are on the following days at 9:00 AM.
const now = zonedTimeToUtc("2026-11-16", 420, TZ);
const dayAt = (offset: number, minutes = 540) =>
  zonedTimeToUtc(`2026-11-${String(17 + offset).padStart(2, "0")}`, minutes, TZ);

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;

async function seedUser(label: string) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: `customers-${stamp()}@example.com` })
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

/** A salon open every day, with Hana and Meron. */
async function seedSalon() {
  const owner = await seedUser("Owner");
  const salon = await createSalon(owner.id, { name: "Records Salon", slug: `records-${stamp()}`, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  const businessId = salon.business.id;
  const hana = await addStylist(businessId, "Hana");
  const meron = await addStylist(businessId, "Meron");
  const scope = (await forBusiness(businessId, owner.id))!;
  const week = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1080 }));
  for (const stylist of [hana, meron]) await setWeeklyHours(scope, stylist.membershipId, week);
  const service = await createService(scope, {
    name: "Braids",
    durationMinutes: 60,
    bufferMinutes: 0,
    locationType: "studio",
    priceStudio: 50_000,
    priceClientPlace: null,
    providerMembershipIds: [hana.membershipId, meron.membershipId],
  });
  if (!service.ok) throw new Error(service.error);
  return {
    scope,
    hana,
    meron,
    context: (await loadBookingContext(businessId, service.service.id))!,
    hanaScope: (await forBusiness(businessId, hana.user.id))!,
    meronScope: (await forBusiness(businessId, meron.user.id))!,
  };
}

/** A customer books a visit a few days ahead; returns the booking id and her record's id. */
async function book(
  context: BookingContext,
  membershipId: string,
  dayOffset: number,
  guest: { name: string; phone: string; allergies?: string },
) {
  const held = await holdSlot(context, {
    startsAt: dayAt(dayOffset),
    membershipId,
    atClientPlace: false,
    source: "business_page",
    now,
  });
  if (!held.ok) throw new Error(held.error);
  const done = await submitBooking(held.token, guest, now);
  if (!done.ok) throw new Error(done.error);
  const [row] = await db.select().from(bookings).where(eq(bookings.id, held.bookingId));
  return { bookingId: held.bookingId, recordId: row!.customerRecordId! };
}

/** Completes a visit once it has happened. */
const complete = (scope: Parameters<typeof completeBooking>[0], bookingId: string, dayOffset: number, amount = 50_000) =>
  completeBooking(scope, bookingId, { amountPaid: amount, method: "cash" }, dayAt(dayOffset, 600));

describe("the customer list", () => {
  it("shows the owner every customer, most recent visit first, and finds them by name or phone", async () => {
    const { scope, context, hana } = await seedSalon();
    const tigistPhone = uniquePhone();
    const tigist = await book(context, hana.membershipId, 0, { name: "Tigist Alemu", phone: tigistPhone, allergies: "Latex" });
    await book(context, hana.membershipId, 1, { name: "Liya Bekele", phone: uniquePhone() });
    const sara = await book(context, hana.membershipId, 2, { name: "Sara Haile", phone: uniquePhone() });
    await complete(scope, tigist.bookingId, 0);
    await complete(scope, sara.bookingId, 2);

    const all = await listCustomers(scope);
    expect(all.map((row) => row.name)).toEqual(["Sara Haile", "Tigist Alemu", "Liya Bekele"]);
    expect(all[1]).toMatchObject({ visitCount: 1, totalSpent: 50_000, allergies: "Latex" });

    expect((await listCustomers(scope, "tigist")).map((row) => row.name)).toEqual(["Tigist Alemu"]);
    expect((await listCustomers(scope, "ALEMU tig")).map((row) => row.name)).toEqual(["Tigist Alemu"]);
    // The number as she would type it, in any of the usual ways.
    expect((await listCustomers(scope, tigistPhone.slice(0, 7))).map((row) => row.name)).toContain("Tigist Alemu");
    expect((await listCustomers(scope, `+251${tigistPhone.slice(1)}`)).map((row) => row.name)).toEqual(["Tigist Alemu"]);
    expect(await listCustomers(scope, "nobody here")).toEqual([]);
  });

  it("shows a stylist only the customers she has served", async () => {
    const { scope, context, hana, meron, hanaScope, meronScope } = await seedSalon();
    const served = await book(context, hana.membershipId, 0, { name: "Served", phone: uniquePhone() });
    await book(context, hana.membershipId, 1, { name: "Only booked", phone: uniquePhone() });
    const missed = await book(context, meron.membershipId, 0, { name: "Missed", phone: uniquePhone() });
    await complete(scope, served.bookingId, 0);
    await markNoShow(scope, missed.bookingId, dayAt(0, 600));

    expect((await listCustomers(hanaScope)).map((row) => row.name)).toEqual(["Served"]);
    expect((await listCustomers(meronScope)).map((row) => row.name)).toEqual(["Missed"]);
    expect(await getCustomer(hanaScope, missed.recordId)).toBeNull();
    expect((await getCustomer(hanaScope, served.recordId))?.canManage).toBe(false);
  });
});

describe("a customer's page", () => {
  it("shows her visits, newest first, with what was paid", async () => {
    const { scope, context, hana, meron } = await seedSalon();
    const phone = uniquePhone();
    const first = await book(context, hana.membershipId, 0, { name: "Tigist", phone });
    const second = await book(context, meron.membershipId, 3, { name: "Tigist", phone });
    await complete(scope, first.bookingId, 0, 45_000);

    const detail = (await getCustomer(scope, first.recordId))!;
    expect(second.recordId).toBe(first.recordId);
    expect(detail.canManage).toBe(true);
    expect(detail.history.map((entry) => [entry.status, entry.professionalName, entry.amountPaid])).toEqual([
      ["confirmed", "Meron", null],
      ["completed", "Hana", 45_000],
    ]);
    expect(detail.history[1]).toMatchObject({ serviceName: "Braids", paymentMethod: "cash" });
  });

  it("keeps the team's notes, and only the author can take hers back", async () => {
    const { scope, context, hana, hanaScope } = await seedSalon();
    const visit = await book(context, hana.membershipId, 0, { name: "Tigist", phone: uniquePhone() });
    await complete(scope, visit.bookingId, 0);

    expect(await addNote(hanaScope, visit.recordId, "Prefers a gentle wash")).toEqual({ ok: true });
    expect(await addNote(scope, visit.recordId, "   ")).toEqual({ ok: false, error: "invalid_input" });
    const [note] = (await getCustomer(scope, visit.recordId))!.notes;
    expect(note).toMatchObject({ body: "Prefers a gentle wash", authorName: "Hana" });

    expect(await deleteNote(scope, note!.id)).toEqual({ ok: false, error: "not_found" });
    expect(await deleteNote(hanaScope, note!.id)).toEqual({ ok: true });
    expect((await getCustomer(scope, visit.recordId))!.notes).toEqual([]);
  });

  it("lets the front of house change her details, but not a stylist", async () => {
    const { scope, context, hana, hanaScope } = await seedSalon();
    const visit = await book(context, hana.membershipId, 0, { name: "Tigist", phone: uniquePhone() });
    await complete(scope, visit.bookingId, 0);
    const details = {
      name: "Tigist Alemu",
      phone: "0912 34 56 78",
      email: "tigist@example.com",
      dateOfBirth: "1995-03-14",
      allergies: "Latex, ammonia",
    };

    expect(await updateCustomer(hanaScope, visit.recordId, details)).toEqual({ ok: false, error: "forbidden" });
    expect(await updateCustomer(scope, visit.recordId, { ...details, phone: "011 123 4567" })).toEqual({
      ok: false,
      error: "phone_invalid",
    });
    expect(await updateCustomer(scope, visit.recordId, { ...details, dateOfBirth: "2099-01-01" })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(await updateCustomer(scope, visit.recordId, details)).toEqual({ ok: true });
    expect((await getCustomer(scope, visit.recordId))!.record).toMatchObject({
      name: "Tigist Alemu",
      phone: "+251912345678",
      email: "tigist@example.com",
      dateOfBirth: "1995-03-14",
      allergies: "Latex, ammonia",
    });
  });

  it("cannot be reached from another business", async () => {
    const mine = await seedSalon();
    const theirs = await seedSalon();
    const visit = await book(theirs.context, theirs.hana.membershipId, 0, { name: "Tigist", phone: uniquePhone() });

    expect(await getCustomer(mine.scope, visit.recordId)).toBeNull();
    expect(await listCustomers(mine.scope)).toEqual([]);
    expect(
      await updateCustomer(mine.scope, visit.recordId, {
        name: "Taken",
        phone: "0911111111",
        email: "",
        dateOfBirth: "",
        allergies: "",
      }),
    ).toEqual({ ok: false, error: "not_found" });
    expect(await addNote(mine.scope, visit.recordId, "hello")).toEqual({ ok: false, error: "not_found" });
    expect(await splitCustomer(mine.scope, visit.recordId, { bookingIds: [visit.bookingId], name: "X Y" })).toEqual({
      ok: false,
      error: "not_found",
    });
  });
});

describe("splitting a record (D92)", () => {
  it("moves one person's bookings and totals to a new record with the same phone", async () => {
    const { scope, context, hana, hanaScope } = await seedSalon();
    const phone = uniquePhone();
    const tigist = await book(context, hana.membershipId, 0, { name: "Tigist", phone });
    // Her sister books with the same phone.
    const sara = await book(context, hana.membershipId, 1, { name: "Sara", phone });
    await complete(scope, tigist.bookingId, 0, 50_000);
    await complete(scope, sara.bookingId, 1, 30_000);
    expect(sara.recordId).toBe(tigist.recordId);
    expect((await getCustomer(scope, tigist.recordId))!.record).toMatchObject({ visitCount: 2, totalSpent: 80_000 });

    expect(await splitCustomer(hanaScope, tigist.recordId, { bookingIds: [sara.bookingId], name: "Sara" })).toEqual({
      ok: false,
      error: "forbidden",
    });
    expect(await splitCustomer(scope, tigist.recordId, { bookingIds: [], name: "Sara" })).toEqual({
      ok: false,
      error: "nothing_to_split",
    });
    expect(
      await splitCustomer(scope, tigist.recordId, { bookingIds: [tigist.bookingId, sara.bookingId], name: "Sara" }),
    ).toEqual({ ok: false, error: "nothing_to_split" });

    const split = await splitCustomer(scope, tigist.recordId, { bookingIds: [sara.bookingId], name: "Sara" });
    if (!split.ok) throw new Error(split.error);

    const original = (await getCustomer(scope, tigist.recordId))!;
    const created = (await getCustomer(scope, split.newRecordId))!;
    expect(original.record).toMatchObject({ visitCount: 1, totalSpent: 50_000 });
    expect(original.history.map((entry) => entry.bookingId)).toEqual([tigist.bookingId]);
    expect(created.record).toMatchObject({
      name: "Sara",
      phone: original.record.phone,
      visitCount: 1,
      totalSpent: 30_000,
      splitFromId: tigist.recordId,
    });
    expect(created.record.lastVisitAt).toEqual(dayAt(1));
    expect(created.history.map((entry) => entry.bookingId)).toEqual([sara.bookingId]);

    // Both still show in the list.
    expect((await listCustomers(scope, original.record.phone)).map((row) => row.name).sort()).toEqual([
      "Sara",
      "Tigist",
    ]);
    const [stored] = await db.select().from(customerRecords).where(eq(customerRecords.id, split.newRecordId));
    expect(stored?.businessId).toBe(scope.businessId);
  });
});
