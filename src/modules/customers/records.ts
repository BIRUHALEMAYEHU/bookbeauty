import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  appointments,
  bookings,
  customerRecords,
  services,
  staffNotes,
  type Booking,
  type CustomerRecord,
} from "@/db/schema";
import type { BusinessScope, ScopedQueries } from "@/db/scope";
import { normalisePhone } from "@/lib/phone";
import { isLocalDate } from "@/lib/time";
import { grantFor } from "@/modules/identity/permissions";

/**
 * Customer records (F24): what a business knows about each customer, built
 * by taking bookings. Who sees them follows playbook 12.1: the owner,
 * managers and front desk see everyone; a stylist sees only customers she
 * has served. Everything goes through the scope.
 */

export type CustomerError = "forbidden" | "not_found" | "invalid_input" | "phone_invalid" | "nothing_to_split";
export type CustomerResult = { ok: true } | { ok: false; error: CustomerError };

/** A visit she has had with this professional counts as "served". */
const SERVED = ["arrived", "completed", "no_show"] as const;

/** Records she may see: all of them, or (for a stylist) the ids of those she has served. */
async function visibleRecordIds(scope: BusinessScope): Promise<"all" | Set<string>> {
  const grant = grantFor(scope.actor.role, "customers.view");
  if (!grant || !scope.can("customers.view")) return new Set();
  if (grant !== "own") return "all";

  const mine = await scope.select(
    appointments,
    eq(appointments.professionalUserId, scope.actor.userId),
  );
  if (mine.length === 0) return new Set();
  const served = await scope.select(
    bookings,
    and(
      inArray(
        bookings.id,
        mine.map((appointment) => appointment.bookingId),
      ),
      inArray(bookings.status, SERVED),
    ),
  );
  return new Set(served.flatMap((booking) => (booking.customerRecordId ? [booking.customerRecordId] : [])));
}

/** Changing a customer's contact details or splitting a record is for the front of house, not a stylist. */
function canManage(scope: BusinessScope) {
  const grant = grantFor(scope.actor.role, "customers.view");
  return Boolean(grant) && grant !== "own" && scope.can("customers.view");
}

export type CustomerListItem = Pick<
  CustomerRecord,
  "id" | "name" | "phone" | "visitCount" | "totalSpent" | "lastVisitAt" | "noShowCount" | "allergies"
>;

/** Digits only, without a leading 0 or 251, so "0911 22", "+25191122" and "91122" all match. */
function phoneDigits(text: string) {
  return text.replace(/\D/g, "").replace(/^(251|0)/, "");
}

/**
 * Customers she may see, most recent visit first (never-visited last,
 * newest first). `query` matches part of a name or a phone number.
 */
export async function listCustomers(
  scope: BusinessScope,
  query = "",
): Promise<CustomerListItem[]> {
  const visible = await visibleRecordIds(scope);
  if (visible !== "all" && visible.size === 0) return [];

  const rows = await scope.select(
    customerRecords,
    visible === "all"
      ? isNull(customerRecords.mergedIntoId)
      : and(isNull(customerRecords.mergedIntoId), inArray(customerRecords.id, [...visible])),
  );

  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const digits = phoneDigits(query);
  const matches = (row: CustomerRecord) =>
    words.length === 0 ||
    words.every((word) => row.name.toLowerCase().includes(word)) ||
    (digits.length >= 3 && phoneDigits(row.phone).includes(digits));

  return rows
    .filter(matches)
    .sort(
      (a, b) =>
        (b.lastVisitAt?.getTime() ?? 0) - (a.lastVisitAt?.getTime() ?? 0) ||
        b.createdAt.getTime() - a.createdAt.getTime(),
    )
    .map(({ id, name, phone, visitCount, totalSpent, lastVisitAt, noShowCount, allergies }) => ({
      id,
      name,
      phone,
      visitCount,
      totalSpent,
      lastVisitAt,
      noShowCount,
      allergies,
    }));
}

export type HistoryEntry = {
  bookingId: string;
  status: Booking["status"];
  startsAt: Date;
  serviceName: string;
  professionalName: string | null;
  /** What was typed when booking; after a shared phone this may be someone else's name. */
  bookedAsName: string | null;
  price: number;
  amountPaid: number | null;
  paymentMethod: string | null;
  currency: string;
  cancelledBy: Booking["cancelledBy"];
};

export type NoteView = {
  id: string;
  body: string;
  authorName: string;
  authorUserId: string;
  createdAt: Date;
};

export type CustomerDetail = {
  record: CustomerRecord;
  history: HistoryEntry[];
  notes: NoteView[];
  /** May change contact details and split the record. */
  canManage: boolean;
};

/** Statuses worth showing in a customer's history (not unfinished holds). */
const HISTORY = [
  "pending_approval",
  "confirmed",
  "arrived",
  "completed",
  "cancelled",
  "no_show",
] as const;

async function loadHistory(scope: BusinessScope | ScopedQueries, recordId: string) {
  const rows = await scope.select(
    bookings,
    and(eq(bookings.customerRecordId, recordId), inArray(bookings.status, HISTORY)),
  );
  if (rows.length === 0) return { rows, appointmentRows: [] };
  const appointmentRows = await scope.select(
    appointments,
    inArray(
      appointments.bookingId,
      rows.map((row) => row.id),
    ),
  );
  return { rows, appointmentRows };
}

/** One customer, with her visits and the team's notes. Null when she may not see it. */
export async function getCustomer(
  scope: BusinessScope,
  recordId: string,
): Promise<CustomerDetail | null> {
  if (!z.uuid().safeParse(recordId).success) return null;
  const visible = await visibleRecordIds(scope);
  if (visible !== "all" && !visible.has(recordId)) return null;

  const [record] = await scope.select(customerRecords, eq(customerRecords.id, recordId));
  if (!record || record.mergedIntoId) return null;

  const [{ rows, appointmentRows }, serviceRows, members, noteRows] = await Promise.all([
    loadHistory(scope, recordId),
    scope.select(services),
    scope.members(),
    scope.select(staffNotes, eq(staffNotes.customerRecordId, recordId)),
  ]);
  const serviceName = new Map(serviceRows.map((row) => [row.id, row.name]));
  const memberName = new Map(members.map((member) => [member.membershipId, member.displayName]));
  const userName = new Map(members.map((member) => [member.userId, member.displayName]));
  const byBooking = new Map(appointmentRows.map((row) => [row.bookingId, row]));

  const history = rows
    .flatMap((booking): HistoryEntry[] => {
      const appointment = byBooking.get(booking.id);
      if (!appointment) return [];
      return [
        {
          bookingId: booking.id,
          status: booking.status,
          startsAt: appointment.startsAt,
          serviceName: serviceName.get(appointment.serviceId) ?? "",
          professionalName: appointment.membershipId
            ? (memberName.get(appointment.membershipId) ?? null)
            : null,
          bookedAsName: booking.customerName,
          price: booking.totalPrice,
          amountPaid: booking.amountPaid,
          paymentMethod: booking.paymentMethod,
          currency: booking.currency,
          cancelledBy: booking.cancelledBy,
        },
      ];
    })
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  const notes = noteRows
    // Private notes are Layer 2; none are written yet, but never show one to anyone else.
    .filter((note) => !note.isPrivate || note.authorUserId === scope.actor.userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map((note) => ({
      id: note.id,
      body: note.body,
      authorUserId: note.authorUserId,
      // Someone who has left the business is no longer a member; her note stays.
      authorName: userName.get(note.authorUserId) ?? "",
      createdAt: note.createdAt,
    }));

  return { record, history, notes, canManage: canManage(scope) };
}

const detailsSchema = z.object({
  name: z.string().trim().min(2).max(100),
  phone: z.string().trim().min(1).max(40),
  email: z.union([z.literal(""), z.email().max(200)]),
  /** "YYYY-MM-DD" or empty. Never asked on the booking form (D21, D67). */
  dateOfBirth: z.string().trim(),
  allergies: z.string().trim().max(500),
});

export type CustomerDetailsInput = z.input<typeof detailsSchema>;

/** Contact details, date of birth and allergies. */
export async function updateCustomer(
  scope: BusinessScope,
  recordId: string,
  input: CustomerDetailsInput,
): Promise<CustomerResult> {
  if (!canManage(scope)) return { ok: false, error: "forbidden" };
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const data = parsed.data;
  const phone = normalisePhone(data.phone);
  if (!phone) return { ok: false, error: "phone_invalid" };
  if (data.dateOfBirth && (!isLocalDate(data.dateOfBirth) || data.dateOfBirth > new Date().toISOString().slice(0, 10))) {
    return { ok: false, error: "invalid_input" };
  }

  const current = await getCustomer(scope, recordId);
  if (!current) return { ok: false, error: "not_found" };
  const { record } = current;
  const after = {
    name: data.name,
    phone,
    email: data.email || null,
    dateOfBirth: data.dateOfBirth || null,
    allergies: data.allergies || null,
  };

  await scope.transaction(async (scoped) => {
    await scoped.update(
      customerRecords,
      { ...after, updatedAt: new Date() },
      eq(customerRecords.id, recordId),
    );
    await scoped.log({
      action: "customer.updated",
      entityType: "customer_record",
      entityId: recordId,
      before: {
        name: record.name,
        phone: record.phone,
        email: record.email,
        dateOfBirth: record.dateOfBirth,
        allergies: record.allergies,
      },
      after,
    });
  });
  return { ok: true };
}

/** Anyone who can see the customer can leave a note for the team. */
export async function addNote(
  scope: BusinessScope,
  recordId: string,
  body: string,
): Promise<CustomerResult> {
  const text = body.trim();
  if (text.length < 1 || text.length > 2000) return { ok: false, error: "invalid_input" };
  if (!(await getCustomer(scope, recordId))) return { ok: false, error: "not_found" };
  await scope.insert(staffNotes, {
    customerRecordId: recordId,
    authorUserId: scope.actor.userId,
    body: text,
  });
  return { ok: true };
}

/** A note can be taken back by whoever wrote it. */
export async function deleteNote(scope: BusinessScope, noteId: string): Promise<CustomerResult> {
  if (!z.uuid().safeParse(noteId).success) return { ok: false, error: "not_found" };
  const removed = await scope.delete(
    staffNotes,
    and(eq(staffNotes.id, noteId), eq(staffNotes.authorUserId, scope.actor.userId)),
  );
  return removed.length > 0 ? { ok: true } : { ok: false, error: "not_found" };
}

/**
 * Works a record's totals out again from its bookings, so they stay right
 * after a split. Cancellations count only those the customer made.
 */
async function recalculateTotals(scoped: ScopedQueries, recordId: string) {
  const rows = await scoped.select(bookings, eq(bookings.customerRecordId, recordId));
  const completed = rows.filter((row) => row.status === "completed");
  const visits = completed.length
    ? await scoped.select(
        appointments,
        inArray(
          appointments.bookingId,
          completed.map((row) => row.id),
        ),
      )
    : [];
  const last = visits.reduce<Date | null>(
    (latest, row) => (!latest || row.startsAt > latest ? row.startsAt : latest),
    null,
  );
  await scoped.update(
    customerRecords,
    {
      visitCount: completed.length,
      totalSpent: completed.reduce((sum, row) => sum + (row.amountPaid ?? 0), 0),
      lastVisitAt: last,
      noShowCount: rows.filter((row) => row.status === "no_show").length,
      cancellationCount: rows.filter(
        (row) => row.status === "cancelled" && row.cancelledBy === "customer",
      ).length,
      updatedAt: new Date(),
    },
    eq(customerRecords.id, recordId),
  );
}

/**
 * Moves some bookings to a new record when one phone number matched two
 * people: a shared phone, a reused number, a prank (D92). The new record
 * keeps the same phone; the bookings and their totals move with it.
 */
export async function splitCustomer(
  scope: BusinessScope,
  recordId: string,
  input: { bookingIds: string[]; name: string },
): Promise<{ ok: true; newRecordId: string } | { ok: false; error: CustomerError }> {
  if (!canManage(scope)) return { ok: false, error: "forbidden" };
  const name = input.name.trim();
  if (name.length < 2 || name.length > 100) return { ok: false, error: "invalid_input" };

  const current = await getCustomer(scope, recordId);
  if (!current) return { ok: false, error: "not_found" };
  const own = new Set(current.history.map((entry) => entry.bookingId));
  const moving = [...new Set(input.bookingIds)].filter((id) => own.has(id));
  // Moving none, or all of them, is not a split.
  if (moving.length === 0 || moving.length === own.size) {
    return { ok: false, error: "nothing_to_split" };
  }

  const newRecordId = await scope.transaction(async (scoped) => {
    const [created] = await scoped.insert(customerRecords, {
      name,
      phone: current.record.phone,
      splitFromId: recordId,
    });
    if (!created) throw new Error("Record was not saved");
    await scoped.update(
      bookings,
      { customerRecordId: created.id, updatedAt: new Date() },
      and(eq(bookings.customerRecordId, recordId), inArray(bookings.id, moving)),
    );
    await recalculateTotals(scoped, recordId);
    await recalculateTotals(scoped, created.id);
    await scoped.log({
      action: "customer.split",
      entityType: "customer_record",
      entityId: recordId,
      after: { newRecordId: created.id, name, bookingIds: moving },
    });
    return created.id;
  });
  return { ok: true, newRecordId };
}
