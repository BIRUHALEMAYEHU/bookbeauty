import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db, type DbExecutor } from "@/db/client";
import {
  appointments,
  availabilityExceptions,
  bookings,
  businesses,
  customerRecords,
  locationClosures,
  locations,
  memberships,
  professionalProfiles,
  serviceProviders,
  services,
  workingHours,
  type Booking,
} from "@/db/schema";
import { normalisePhone } from "@/lib/phone";
import { addDays, isLocalDate, localDateOf, zonedTimeToUtc, type LocalDate } from "@/lib/time";
import { generateToken, hashToken } from "@/lib/tokens";
import { logActivity } from "@/modules/audit/log";
import { openSlots, type Period, type ProfessionalDay } from "@/modules/availability/slots";

/**
 * Taking bookings from guests (F15, F16, F17, F20). Guests have no
 * membership, so there is no scope here: every query names the business it
 * is for. The one deliberate exception is a professional's busy time, which
 * is read across all the businesses she works at (only the times, nothing
 * else), because a booking at one place blocks her at the others.
 *
 * The flow (technical-plan Section 6): picking a time holds it for ten
 * minutes; giving her details turns the hold into a booking. The database's
 * exclusion constraint is what finally stops two people getting one slot.
 */

export const HOLD_MINUTES = 10;
/** A guest may cancel from her link until this long before the start (D104). */
export const GUEST_CANCEL_NOTICE_MINUTES = 120;

const ACTING = ["active", "notice"] as const;
const MINUTE = 60_000;

export type BookingProvider = {
  membershipId: string;
  userId: string;
  displayName: string;
  handle: string;
  travelBufferMinutes: number;
};

export type BookingContext = {
  business: {
    id: string;
    kind: "independent" | "salon";
    name: string;
    timeZone: string;
    approvalMode: "auto" | "manual";
    minNoticeMinutes: number;
    maxAdvanceDays: number;
  };
  locationId: string;
  service: {
    id: string;
    name: string;
    durationMinutes: number;
    bufferMinutes: number;
    locationType: "studio" | "client_place" | "both";
    priceStudio: number | null;
    priceClientPlace: number | null;
    currency: string;
    requiresApproval: boolean | null;
  };
  /** Who can perform it, in the order they joined. */
  providers: BookingProvider[];
};

/** Everything needed to offer one service of one business. Null when it cannot be booked at all. */
export async function loadBookingContext(
  businessId: string,
  serviceId: string,
): Promise<BookingContext | null> {
  if (!z.uuid().safeParse(businessId).success || !z.uuid().safeParse(serviceId).success) return null;

  const [row] = await db
    .select({
      business: {
        id: businesses.id,
        kind: businesses.kind,
        name: businesses.name,
        timeZone: businesses.timeZone,
        approvalMode: businesses.approvalMode,
        minNoticeMinutes: businesses.minNoticeMinutes,
        maxAdvanceDays: businesses.maxAdvanceDays,
      },
      service: {
        id: services.id,
        name: services.name,
        durationMinutes: services.durationMinutes,
        bufferMinutes: services.bufferMinutes,
        locationType: services.locationType,
        priceStudio: services.priceStudio,
        priceClientPlace: services.priceClientPlace,
        currency: services.currency,
        requiresApproval: services.requiresApproval,
      },
      locationId: locations.id,
    })
    .from(services)
    .innerJoin(businesses, eq(businesses.id, services.businessId))
    .innerJoin(
      locations,
      and(eq(locations.businessId, businesses.id), eq(locations.isDefault, true)),
    )
    .where(
      and(
        eq(services.id, serviceId),
        eq(services.businessId, businessId),
        eq(services.status, "active"),
        eq(businesses.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;

  const providers = await db
    .select({
      membershipId: memberships.id,
      userId: memberships.userId,
      displayName: professionalProfiles.displayName,
      handle: professionalProfiles.handle,
      travelBufferMinutes: memberships.travelBufferMinutes,
    })
    .from(serviceProviders)
    .innerJoin(memberships, eq(memberships.id, serviceProviders.membershipId))
    .innerJoin(professionalProfiles, eq(professionalProfiles.userId, memberships.userId))
    .where(
      and(
        eq(serviceProviders.serviceId, serviceId),
        eq(serviceProviders.businessId, businessId),
        eq(memberships.businessId, businessId),
        inArray(memberships.status, ACTING),
      ),
    )
    .orderBy(asc(memberships.startedAt), asc(memberships.id));

  return { ...row, providers };
}

/** The price for where the service is done; null when it is not offered there. */
export function priceFor(context: BookingContext, atClientPlace: boolean): number | null {
  const { service } = context;
  if (atClientPlace) return service.locationType === "studio" ? null : service.priceClientPlace;
  return service.locationType === "client_place" ? null : service.priceStudio;
}

/** A hold that has run out no longer blocks anything, even before it is tidied away. */
function stillBlocking(now: Date) {
  return or(
    sql`${bookings.status} <> 'held'`,
    gt(bookings.holdExpiresAt, now),
  );
}

type DayInputs = { closures: Period[]; days: Map<string, ProfessionalDay> };

/** Gathers what the slot calculator needs for these professionals around one day. */
async function loadDayInputs(
  context: BookingContext,
  providers: BookingProvider[],
  date: LocalDate,
  now: Date,
  executor: DbExecutor = db,
): Promise<DayInputs> {
  const { timeZone } = context.business;
  // A day either side, so an appointment or time off that crosses midnight is seen.
  const from = zonedTimeToUtc(addDays(date, -1), 0, timeZone);
  const to = zonedTimeToUtc(addDays(date, 2), 0, timeZone);
  const membershipIds = providers.map((provider) => provider.membershipId);
  const userIds = providers.map((provider) => provider.userId);
  if (providers.length === 0) return { closures: [], days: new Map() };

  const [shifts, exceptions, closures, busy] = await Promise.all([
    executor
      .select()
      .from(workingHours)
      .where(
        and(
          eq(workingHours.businessId, context.business.id),
          inArray(workingHours.membershipId, membershipIds),
        ),
      ),
    executor
      .select()
      .from(availabilityExceptions)
      .where(
        and(
          eq(availabilityExceptions.businessId, context.business.id),
          inArray(availabilityExceptions.membershipId, membershipIds),
          lt(availabilityExceptions.startsAt, to),
          gt(availabilityExceptions.endsAt, from),
        ),
      ),
    executor
      .select({ startsAt: locationClosures.startsAt, endsAt: locationClosures.endsAt })
      .from(locationClosures)
      .where(
        and(
          eq(locationClosures.businessId, context.business.id),
          eq(locationClosures.locationId, context.locationId),
          lt(locationClosures.startsAt, to),
          gt(locationClosures.endsAt, from),
        ),
      ),
    // Her time at every business she works at: only when, never what or for whom.
    executor
      .select({
        userId: appointments.professionalUserId,
        startsAt: appointments.startsAt,
        endsAt: appointments.blockedUntil,
      })
      .from(appointments)
      .innerJoin(bookings, eq(bookings.id, appointments.bookingId))
      .where(
        and(
          inArray(appointments.professionalUserId, userIds),
          eq(appointments.status, "active"),
          lt(appointments.startsAt, to),
          gt(appointments.blockedUntil, from),
          stillBlocking(now),
        ),
      ),
  ]);

  const days = new Map<string, ProfessionalDay>();
  for (const provider of providers) {
    const own = exceptions.filter((row) => row.membershipId === provider.membershipId);
    days.set(provider.membershipId, {
      membershipId: provider.membershipId,
      shifts: shifts.filter((row) => row.membershipId === provider.membershipId),
      timeOff: own.filter((row) => row.kind === "time_off"),
      extraHours: own.filter((row) => row.kind === "extra_hours"),
      busy: busy.filter((row) => row.userId === provider.userId),
    });
  }
  return { closures, days };
}

export type OpenSlot = { startsAt: Date; membershipIds: string[] };

export type SlotQuery = {
  date: LocalDate;
  /** A chosen professional, or null for "Any available" (D84). */
  membershipId: string | null;
  atClientPlace: boolean;
  now?: Date;
};

function chosenProviders(context: BookingContext, membershipId: string | null) {
  return membershipId
    ? context.providers.filter((provider) => provider.membershipId === membershipId)
    : context.providers;
}

async function slotsFor(
  context: BookingContext,
  query: Required<SlotQuery>,
  executor: DbExecutor = db,
): Promise<OpenSlot[]> {
  if (!isLocalDate(query.date) || priceFor(context, query.atClientPlace) === null) return [];
  const providers = chosenProviders(context, query.membershipId);
  const inputs = await loadDayInputs(context, providers, query.date, query.now, executor);

  // One pass per professional, because travel time after a home visit is her own.
  const byStart = new Map<number, string[]>();
  for (const provider of providers) {
    const slots = openSlots({
      date: query.date,
      timeZone: context.business.timeZone,
      now: query.now,
      durationMinutes: context.service.durationMinutes,
      bufferMinutes:
        context.service.bufferMinutes + (query.atClientPlace ? provider.travelBufferMinutes : 0),
      minNoticeMinutes: context.business.minNoticeMinutes,
      maxAdvanceDays: context.business.maxAdvanceDays,
      closures: inputs.closures,
      professionals: [inputs.days.get(provider.membershipId)!],
    });
    for (const slot of slots) {
      const start = slot.startsAt.getTime();
      byStart.set(start, [...(byStart.get(start) ?? []), provider.membershipId]);
    }
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, membershipIds]) => ({ startsAt: new Date(start), membershipIds }));
}

/** The times a customer can book on one day. */
export function getOpenSlots(context: BookingContext, query: SlotQuery): Promise<OpenSlot[]> {
  return slotsFor(context, { ...query, now: query.now ?? new Date() });
}

/**
 * Marks one business's run-out holds as expired and frees their time. Safe
 * to call at any moment. Tidying only: a run-out hold already stops blocking
 * times the moment it runs out, at every business (see `stillBlocking`).
 */
export async function expireStaleHolds(
  businessId: string,
  now = new Date(),
  executor: DbExecutor = db,
) {
  const expired = await executor
    .update(bookings)
    .set({ status: "expired", updatedAt: now })
    .where(
      and(
        eq(bookings.businessId, businessId),
        eq(bookings.status, "held"),
        lt(bookings.holdExpiresAt, now),
      ),
    )
    .returning({ id: bookings.id });
  if (expired.length === 0) return 0;
  await executor
    .update(appointments)
    .set({ status: "cancelled" })
    .where(
      inArray(
        appointments.bookingId,
        expired.map((row) => row.id),
      ),
    );
  return expired.length;
}

export type HoldInput = {
  startsAt: Date;
  membershipId: string | null;
  atClientPlace: boolean;
  source: "business_page" | "professional_page";
  now?: Date;
};

export type HoldResult =
  | { ok: true; token: string; bookingId: string; holdExpiresAt: Date }
  /** slot_taken: it was free a moment ago; not_available: it never was. */
  | { ok: false; error: "slot_taken" | "not_available" };

/**
 * The database refused the appointment because someone else is taking the
 * same time. 23P01: the rule against double-booking found a finished
 * booking. 40P01: two customers were inserting the same time at the same
 * instant, each waiting for the other; the database lets one through and
 * aborts the other. Both mean "that time was just taken".
 */
function isDoubleBooking(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth++) {
    const candidate = current as { code?: string; cause?: unknown };
    if (candidate.code === "23P01" || candidate.code === "40P01") return true;
    current = candidate.cause;
  }
  return false;
}

/** How many appointments each of these people already has that day, for a fair pick. */
async function loadOfDay(userIds: string[], dayStart: Date, dayEnd: Date, now: Date) {
  const rows = await db
    .select({ userId: appointments.professionalUserId, count: sql<number>`count(*)::int` })
    .from(appointments)
    .innerJoin(bookings, eq(bookings.id, appointments.bookingId))
    .where(
      and(
        inArray(appointments.professionalUserId, userIds),
        eq(appointments.status, "active"),
        lt(appointments.startsAt, dayEnd),
        gt(appointments.blockedUntil, dayStart),
        stillBlocking(now),
      ),
    )
    .groupBy(appointments.professionalUserId);
  return new Map(rows.map((row) => [row.userId, row.count]));
}

/**
 * Reserves a time the instant the customer picks it (playbook 8.11). For
 * "Any available" it takes the free professional with the fewest bookings
 * that day (D98) and, if someone else gets her first, tries the next.
 */
export async function holdSlot(context: BookingContext, input: HoldInput): Promise<HoldResult> {
  const now = input.now ?? new Date();
  const price = priceFor(context, input.atClientPlace);
  if (price === null) return { ok: false, error: "not_available" };

  await expireStaleHolds(context.business.id, now);

  const { timeZone } = context.business;
  const date = localDateOf(input.startsAt, timeZone);
  const open = await slotsFor(context, {
    date,
    membershipId: input.membershipId,
    atClientPlace: input.atClientPlace,
    now,
  });
  const slot = open.find((candidate) => candidate.startsAt.getTime() === input.startsAt.getTime());
  if (!slot) return { ok: false, error: "not_available" };

  const free = context.providers.filter((provider) =>
    slot.membershipIds.includes(provider.membershipId),
  );
  const load = await loadOfDay(
    free.map((provider) => provider.userId),
    zonedTimeToUtc(date, 0, timeZone),
    zonedTimeToUtc(date, 1440, timeZone),
    now,
  );
  // A stable sort: among equals, whoever joined first.
  const candidates = [...free].sort(
    (a, b) => (load.get(a.userId) ?? 0) - (load.get(b.userId) ?? 0),
  );

  const endsAt = new Date(input.startsAt.getTime() + context.service.durationMinutes * MINUTE);
  const holdExpiresAt = new Date(now.getTime() + HOLD_MINUTES * MINUTE);

  for (const provider of candidates) {
    const token = generateToken();
    const blockedUntil = new Date(
      endsAt.getTime() +
        (context.service.bufferMinutes +
          (input.atClientPlace ? provider.travelBufferMinutes : 0)) *
          MINUTE,
    );
    try {
      const bookingId = await db.transaction(async (tx) => {
        const [booking] = await tx
          .insert(bookings)
          .values({
            businessId: context.business.id,
            locationId: context.locationId,
            status: "held",
            source: input.source,
            atClientPlace: input.atClientPlace,
            totalPrice: price,
            currency: context.service.currency,
            holdExpiresAt,
            manageTokenHash: hashToken(token),
          })
          .returning({ id: bookings.id });
        if (!booking) throw new Error("Hold was not saved");
        // This insert is where the database refuses a second booking of the same time.
        await tx.insert(appointments).values({
          bookingId: booking.id,
          businessId: context.business.id,
          serviceId: context.service.id,
          membershipId: provider.membershipId,
          professionalUserId: provider.userId,
          assignment: input.membershipId ? "requested" : "auto",
          startsAt: input.startsAt,
          endsAt,
          blockedUntil,
          price,
          currency: context.service.currency,
        });
        return booking.id;
      });
      return { ok: true, token, bookingId, holdExpiresAt };
    } catch (error) {
      if (!isDoubleBooking(error)) throw error;
      // Someone took her in the same instant; try the next free professional.
    }
  }
  return { ok: false, error: "slot_taken" };
}

/** What the person holding a booking link may see of it. */
export type GuestBooking = {
  id: string;
  businessId: string;
  status: Booking["status"];
  businessName: string;
  businessKind: "independent" | "salon";
  timeZone: string;
  serviceName: string;
  /** Null when she asked for "Any available": who it will be is the business's to say. */
  professionalName: string | null;
  startsAt: Date;
  endsAt: Date;
  atClientPlace: boolean;
  totalPrice: number;
  currency: string;
  holdExpiresAt: Date | null;
  cancelledBy: Booking["cancelledBy"];
  canCancel: boolean;
  /** The business's public page, to book again: "/slug" or "/@handle". */
  publicPath: string | null;
};

/** The owner's profile, for a solo practice's address: a second look at the same table. */
const ownerProfiles = alias(professionalProfiles, "owner_profiles");

async function findByToken(token: string, executor: DbExecutor = db) {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const [row] = await executor
    .select({
      booking: bookings,
      appointment: appointments,
      businessName: businesses.name,
      businessKind: businesses.kind,
      slug: businesses.slug,
      ownerHandle: ownerProfiles.handle,
      timeZone: businesses.timeZone,
      approvalMode: businesses.approvalMode,
      serviceName: services.name,
      requiresApproval: services.requiresApproval,
      professionalName: professionalProfiles.displayName,
    })
    .from(bookings)
    .innerJoin(appointments, eq(appointments.bookingId, bookings.id))
    .innerJoin(businesses, eq(businesses.id, bookings.businessId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(professionalProfiles, eq(professionalProfiles.userId, appointments.professionalUserId))
    .leftJoin(ownerProfiles, eq(ownerProfiles.userId, businesses.ownerUserId))
    .where(eq(bookings.manageTokenHash, hashToken(token)))
    .orderBy(asc(appointments.startsAt))
    .limit(1);
  return row ?? null;
}

function guestCanCancel(status: Booking["status"], startsAt: Date, now: Date) {
  return (
    (status === "confirmed" || status === "pending_approval") &&
    startsAt.getTime() - now.getTime() >= GUEST_CANCEL_NOTICE_MINUTES * MINUTE
  );
}

/** Her booking, from the secret in her link. A run-out hold reads as expired. */
export async function getGuestBooking(token: string, now = new Date()): Promise<GuestBooking | null> {
  const row = await findByToken(token);
  if (!row) return null;
  const { booking, appointment } = row;
  const status =
    booking.status === "held" && booking.holdExpiresAt && booking.holdExpiresAt <= now
      ? "expired"
      : booking.status;
  return {
    id: booking.id,
    businessId: booking.businessId,
    status,
    businessName: row.businessName,
    businessKind: row.businessKind,
    timeZone: row.timeZone,
    serviceName: row.serviceName,
    professionalName: appointment.assignment === "requested" ? row.professionalName : null,
    startsAt: appointment.startsAt,
    endsAt: appointment.endsAt,
    atClientPlace: booking.atClientPlace,
    totalPrice: booking.totalPrice,
    currency: booking.currency,
    holdExpiresAt: booking.holdExpiresAt,
    cancelledBy: booking.cancelledBy,
    canCancel: guestCanCancel(status, appointment.startsAt, now),
    publicPath:
      row.businessKind === "salon"
        ? row.slug
          ? `/${row.slug}`
          : null
        : row.ownerHandle
          ? `/@${row.ownerHandle}`
          : null,
  };
}

const detailsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(1).max(40),
  email: z.union([z.literal(""), z.email().max(200)]).optional(),
  notes: z.string().trim().max(1000).optional(),
  allergies: z.string().trim().max(500).optional(),
  addressText: z.string().trim().max(500).optional(),
});

export type GuestDetails = z.input<typeof detailsSchema>;

export type SubmitResult =
  | { ok: true; status: "confirmed" | "pending_approval" }
  | {
      ok: false;
      error: "invalid_input" | "phone_invalid" | "address_required" | "expired" | "not_found";
    };

/** Adds what she says now to what is on file, without losing either: allergies are safety information (D43). */
function mergeAllergies(onFile: string | null, given: string | null) {
  if (!given) return onFile;
  if (!onFile) return given;
  return onFile.toLowerCase().includes(given.toLowerCase()) ? onFile : `${onFile}\n${given}`;
}

/**
 * Turns a hold into a booking. The booking is attached to the customer
 * record with the same phone, or a new one (D92). Nothing from an existing
 * record is returned: a phone number is not proof of who is typing (D91).
 */
export async function submitBooking(
  token: string,
  input: GuestDetails,
  now = new Date(),
): Promise<SubmitResult> {
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;
  const phone = normalisePhone(data.phone);
  if (!phone) return { ok: false, error: "phone_invalid" };

  return db.transaction(async (tx): Promise<SubmitResult> => {
    const row = await findByToken(token, tx);
    if (!row) return { ok: false, error: "not_found" };
    const { booking } = row;
    if (booking.status !== "held" || !booking.holdExpiresAt || booking.holdExpiresAt <= now) {
      return { ok: false, error: "expired" };
    }
    if (booking.atClientPlace && !data.addressText) return { ok: false, error: "address_required" };

    const email = data.email || null;
    const allergies = data.allergies || null;
    const notes = data.notes || null;

    // The most recently used record with this number (after a split there can be two).
    const [existing] = await tx
      .select()
      .from(customerRecords)
      .where(
        and(
          eq(customerRecords.businessId, booking.businessId),
          eq(customerRecords.phone, phone),
          isNull(customerRecords.mergedIntoId),
        ),
      )
      .orderBy(desc(customerRecords.updatedAt))
      .limit(1);

    let customerRecordId: string;
    if (existing) {
      customerRecordId = existing.id;
      await tx
        .update(customerRecords)
        .set({
          // Her name on file stays; the name typed now is kept on the booking.
          email: existing.email ?? email,
          allergies: mergeAllergies(existing.allergies, allergies),
          updatedAt: now,
        })
        .where(eq(customerRecords.id, existing.id));
    } else {
      const [created] = await tx
        .insert(customerRecords)
        .values({ businessId: booking.businessId, name: data.name, phone, email, allergies })
        .returning({ id: customerRecords.id });
      if (!created) throw new Error("Customer record was not saved");
      customerRecordId = created.id;
    }

    const needsApproval = row.requiresApproval ?? row.approvalMode === "manual";
    const status = needsApproval ? "pending_approval" : "confirmed";

    // Only a hold that is still running can become a booking, whatever happened meanwhile.
    const [updated] = await tx
      .update(bookings)
      .set({
        status,
        customerRecordId,
        customerName: data.name,
        customerPhone: phone,
        customerEmail: email,
        customerNotes: notes,
        clientAddressText: booking.atClientPlace ? data.addressText : null,
        holdExpiresAt: null,
        updatedAt: now,
      })
      .where(
        and(eq(bookings.id, booking.id), eq(bookings.status, "held"), gt(bookings.holdExpiresAt, now)),
      )
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, error: "expired" };

    await logActivity(
      {
        businessId: booking.businessId,
        action: needsApproval ? "booking.requested" : "booking.confirmed",
        entityType: "booking",
        entityId: booking.id,
        after: { status, startsAt: row.appointment.startsAt.toISOString(), source: booking.source },
      },
      tx,
    );
    return { ok: true, status };
  });
}

export type GuestCancelResult = { ok: true } | { ok: false; error: "not_found" | "too_late" };

/** She cancels from her link, up to two hours before (D104). Her time is freed at once. */
export async function cancelByGuest(token: string, now = new Date()): Promise<GuestCancelResult> {
  return db.transaction(async (tx): Promise<GuestCancelResult> => {
    const row = await findByToken(token, tx);
    if (!row) return { ok: false, error: "not_found" };
    const { booking, appointment } = row;

    // Letting go of a hold she has not finished is always allowed.
    const releasingHold = booking.status === "held";
    if (!releasingHold && !guestCanCancel(booking.status, appointment.startsAt, now)) {
      return { ok: false, error: "too_late" };
    }

    const [updated] = await tx
      .update(bookings)
      .set(
        releasingHold
          ? { status: "expired", holdExpiresAt: now, updatedAt: now }
          : { status: "cancelled", cancelledAt: now, cancelledBy: "customer", updatedAt: now },
      )
      .where(and(eq(bookings.id, booking.id), eq(bookings.status, booking.status)))
      .returning({ id: bookings.id });
    if (!updated) return { ok: false, error: "too_late" };

    await tx
      .update(appointments)
      .set({ status: "cancelled" })
      .where(eq(appointments.bookingId, booking.id));

    if (!releasingHold) {
      if (booking.customerRecordId) {
        await tx
          .update(customerRecords)
          .set({ cancellationCount: sql`${customerRecords.cancellationCount} + 1` })
          .where(eq(customerRecords.id, booking.customerRecordId));
      }
      await logActivity(
        {
          businessId: booking.businessId,
          action: "booking.cancelled_by_customer",
          entityType: "booking",
          entityId: booking.id,
          before: { status: booking.status },
          after: { status: "cancelled" },
        },
        tx,
      );
    }
    return { ok: true };
  });
}
