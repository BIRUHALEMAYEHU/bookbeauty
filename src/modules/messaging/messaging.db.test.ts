import { and, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db/client";
import { memberships, messages, users } from "@/db/schema";
import { forBusiness } from "@/db/scope";
import { capturedEmails } from "@/integrations/email";
import { zonedTimeToUtc } from "@/lib/time";
import { setWeeklyHours } from "@/modules/availability/hours";
import {
  cancelByGuest,
  holdSlot,
  loadBookingContext,
  submitBooking,
  type BookingContext,
} from "@/modules/booking/engine";
import { approveBooking, cancelBookingByBusiness, setApprovalMode } from "@/modules/booking/manage";
import { createSalon } from "@/modules/businesses/create";
import { createService } from "@/modules/catalog/services";
import { createProfessionalProfile } from "@/modules/identity/profiles";
import { deliverDueMessages, MAX_ATTEMPTS } from "./deliver";

// Lets a test make the email provider fail.
const provider = vi.hoisted(() => ({ down: false }));
vi.mock("@/integrations/email", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/integrations/email")>();
  return {
    ...real,
    sendEmail: async (message: Parameters<typeof real.sendEmail>[0]) => {
      if (provider.down) throw new Error("Provider is down");
      return real.sendEmail(message);
    },
  };
});

const TZ = "Africa/Addis_Ababa";
// "Now" is Monday 16 November 2026, 9:00 AM; the visits are Wednesday at 10:00 AM, so the
// reminder is due Tuesday at 10:00 AM.
const now = zonedTimeToUtc("2026-11-16", 540, TZ);
const dayBefore = zonedTimeToUtc("2026-11-17", 600, TZ);

function stamp() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}
const uniquePhone = () => `09${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
const uniqueEmail = (label: string) => `${label}-${stamp()}@example.com`;

async function seedUser(label: string, verified: boolean) {
  const [user] = await db
    .insert(users)
    .values({ displayName: label, email: uniqueEmail(label.toLowerCase()), emailVerifiedAt: verified ? now : null })
    .returning();
  return user!;
}

/** A salon whose owner and stylist Hana have verified emails; Meron's is not verified. */
async function seedSalon() {
  const owner = await seedUser("Owner", true);
  const salon = await createSalon(owner.id, { name: "Selam Hair", slug: `msg-${stamp()}`, category: "hair" });
  if (!salon.ok) throw new Error(salon.error);
  const scope = (await forBusiness(salon.business.id, owner.id))!;
  const people = [];
  for (const [name, verified] of [["Hana", true], ["Meron", false]] as const) {
    const user = await seedUser(name, verified);
    await createProfessionalProfile(user.id, { handle: `${name.toLowerCase()}-${stamp()}`, displayName: name });
    const [membership] = await db
      .insert(memberships)
      .values({ businessId: salon.business.id, userId: user.id, role: "stylist" })
      .returning();
    await setWeeklyHours(scope, membership!.id, [{ weekday: 3, startMinute: 540, endMinute: 1080 }]);
    people.push({ user, membershipId: membership!.id });
  }
  const service = await createService(scope, {
    name: "Wash and blow-dry",
    durationMinutes: 45,
    bufferMinutes: 0,
    locationType: "studio",
    priceStudio: 35_000,
    priceClientPlace: null,
    providerMembershipIds: people.map((person) => person.membershipId),
  });
  if (!service.ok) throw new Error(service.error);
  const [hana, meron] = people as [(typeof people)[0], (typeof people)[0]];
  return { owner, scope, hana, meron, context: (await loadBookingContext(salon.business.id, service.service.id))! };
}

async function book(context: BookingContext, membershipId: string, email: string | undefined, minutes = 600) {
  const held = await holdSlot(context, {
    startsAt: zonedTimeToUtc("2026-11-18", minutes, TZ),
    membershipId,
    atClientPlace: false,
    source: "business_page",
    now,
  });
  if (!held.ok) throw new Error(held.error);
  const done = await submitBooking(held.token, { name: "Tigist", phone: uniquePhone(), email }, now);
  if (!done.ok) throw new Error(done.error);
  return { token: held.token, id: held.bookingId, status: done.status };
}

const rowsFor = (bookingId: string) => db.select().from(messages).where(eq(messages.bookingId, bookingId));
const kinds = async (bookingId: string) =>
  (await rowsFor(bookingId)).map((row) => `${row.kind}:${row.status}`).sort();
const sentTo = (email: string) => capturedEmails().filter((message) => message.to === email);

describe("messages about a booking (F26)", () => {
  it("confirms to the customer with her link, tells the staff, and reminds her a day before", async () => {
    const { context, hana, owner } = await seedSalon();
    const email = uniqueEmail("tigist");
    const booking = await book(context, hana.membershipId, email);

    const rows = await rowsFor(booking.id);
    expect(rows.map((row) => `${row.kind}:${row.recipient}`).sort()).toEqual(
      [
        `booking_confirmation:${email}`,
        `booking_reminder:${email}`,
        `new_booking_notice:${hana.user.email}`,
        `new_booking_notice:${owner.email}`,
      ].sort(),
    );
    expect(rows.find((row) => row.kind === "booking_reminder")?.scheduledFor).toEqual(dayBefore);

    await deliverDueMessages(now);
    expect(await kinds(booking.id)).toEqual([
      "booking_confirmation:sent",
      "booking_reminder:queued",
      "new_booking_notice:sent",
      "new_booking_notice:sent",
    ]);
    const [confirmation] = sentTo(email);
    expect(confirmation?.subject).toBe("You are booked at Selam Hair");
    expect(confirmation?.text).toContain(`/booking/${booking.token}`);
    expect(confirmation?.text).toContain("Wed, 18 Nov 2026, 10:00 AM");
    expect(confirmation?.text).toContain("With Hana");
    // The link is wiped once it is sent: links are otherwise stored only as hashes.
    expect((await rowsFor(booking.id)).every((row) => row.linkToken === null)).toBe(true);
    expect(sentTo(owner.email!)[0]?.subject).toBe("New booking: Tigist");

    await deliverDueMessages(dayBefore);
    expect(await kinds(booking.id)).toContain("booking_reminder:sent");
    const reminder = sentTo(email).find((message) => message.subject.startsWith("Reminder"));
    expect(reminder?.text).not.toContain("/booking/");
  });

  it("sends nothing to a customer who gave no email, and nothing to an unverified address", async () => {
    const { context, meron, owner } = await seedSalon();
    const booking = await book(context, meron.membershipId, undefined);
    // Meron's email is not verified, so only the owner hears about it.
    expect((await rowsFor(booking.id)).map((row) => `${row.kind}:${row.recipient}`)).toEqual([
      `new_booking_notice:${owner.email}`,
    ]);
  });

  it("follows a request through approval or decline", async () => {
    const { context, hana, scope } = await seedSalon();
    await setApprovalMode(scope, "manual");
    const first = await book(context, hana.membershipId, uniqueEmail("liya"), 600);
    const second = await book(context, hana.membershipId, uniqueEmail("sara"), 720);
    // A request gets no reminder until it is approved.
    expect(await kinds(first.id)).toEqual([
      "booking_request_received:queued",
      "new_booking_notice:queued",
      "new_booking_notice:queued",
    ]);

    await approveBooking(scope, first.id, now);
    expect(await kinds(first.id)).toEqual([
      "booking_approved:queued",
      "booking_reminder:queued",
      "booking_request_received:queued",
      "new_booking_notice:queued",
      "new_booking_notice:queued",
    ]);

    await cancelBookingByBusiness(scope, second.id, undefined, now);
    expect(await kinds(second.id)).toContain("booking_declined:queued");
    expect(await kinds(second.id)).not.toContain("booking_reminder:queued");
  });

  it("calls off the reminder when the booking is cancelled, and tells the staff", async () => {
    const { context, hana } = await seedSalon();
    const booking = await book(context, hana.membershipId, uniqueEmail("tigist"));
    expect(await cancelByGuest(booking.token, now)).toEqual({ ok: true });

    expect(await kinds(booking.id)).toEqual([
      "booking_cancelled_notice:queued",
      "booking_cancelled_notice:queued",
      "booking_confirmation:queued",
      "booking_reminder:cancelled",
      "new_booking_notice:queued",
      "new_booking_notice:queued",
    ]);
  });

  it("does not send a reminder for a visit that was cancelled after it was queued", async () => {
    const { context, hana, scope } = await seedSalon();
    const booking = await book(context, hana.membershipId, uniqueEmail("tigist"));
    // Cancelled behind the messaging code's back: the sender still checks.
    await db
      .update(messages)
      .set({ status: "queued" })
      .where(and(eq(messages.bookingId, booking.id), eq(messages.kind, "booking_reminder")));
    await cancelBookingByBusiness(scope, booking.id, undefined, now);
    await db
      .update(messages)
      .set({ status: "queued" })
      .where(and(eq(messages.bookingId, booking.id), eq(messages.kind, "booking_reminder")));

    await deliverDueMessages(dayBefore);
    expect(await kinds(booking.id)).toContain("booking_reminder:cancelled");
  });

  it("retries a failed send with growing gaps, then gives up and keeps it visible", async () => {
    const { context, hana } = await seedSalon();
    const email = uniqueEmail("tigist");
    const booking = await book(context, hana.membershipId, email);
    const confirmation = async () =>
      (await rowsFor(booking.id)).find((row) => row.kind === "booking_confirmation")!;

    provider.down = true;
    try {
      let at = now;
      for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        await deliverDueMessages(at);
        const row = await confirmation();
        expect(row.attempts).toBe(attempt);
        if (attempt < MAX_ATTEMPTS) {
          expect(row).toMatchObject({ status: "queued", error: "Provider is down" });
          expect(row.scheduledFor.getTime() - at.getTime()).toBe(attempt * attempt * 60_000);
          at = row.scheduledFor;
        } else {
          expect(row).toMatchObject({ status: "failed", linkToken: null });
        }
      }
    } finally {
      provider.down = false;
    }
    expect(sentTo(email)).toEqual([]);
  });
});
