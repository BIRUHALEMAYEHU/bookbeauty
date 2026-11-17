import "server-only";
import { and, eq, gte, inArray, lt } from "drizzle-orm";
import { appointments, bookings, services } from "@/db/schema";
import type { BusinessScope } from "@/db/scope";
import { addDays, zonedTimeToUtc } from "@/lib/time";
import { grantFor } from "@/modules/identity/permissions";

/**
 * The income tracker (F25, playbook Chapter 13): what was paid for completed
 * visits, from the amount and method recorded when each was completed (D59).
 * Income belongs to the day of the visit, not the day someone pressed
 * Complete. The owner sees everything; a stylist only her own (14.3).
 */

export type Month = `${number}-${string}`;

export type IncomeLine = { key: string; label: string; amount: number; visits: number };

export type IncomeVisit = {
  bookingId: string;
  startsAt: Date;
  serviceName: string;
  professionalName: string | null;
  customerName: string | null;
  customerRecordId: string | null;
  amountPaid: number;
  paymentMethod: string;
};

export type IncomeReport = {
  month: string;
  total: number;
  visits: number;
  /** Rounded to whole santim. */
  average: number;
  currency: string;
  byMethod: IncomeLine[];
  byService: IncomeLine[];
  /** Empty for a stylist, who sees only her own. */
  byProfessional: IncomeLine[];
  entries: IncomeVisit[];
  ownOnly: boolean;
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function isMonth(text: string): text is Month {
  return MONTH.test(text);
}

/** "2026-11" for the month a local date falls in. */
export function monthOf(localDate: string): Month {
  return localDate.slice(0, 7) as Month;
}

/** The month before or after, as "YYYY-MM". */
export function shiftMonth(month: Month, by: number): Month {
  const [year, m] = month.split("-").map(Number) as [number, number];
  const index = year * 12 + (m - 1) + by;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}` as Month;
}

/** The first and last day of the month: "2026-11-01" and "2026-11-30". */
export function monthDays(month: Month) {
  const first = `${month}-01`;
  const last = addDays(`${shiftMonth(month, 1)}-01`, -1);
  return { first, last };
}

function group(entries: IncomeVisit[], key: (entry: IncomeVisit) => [string, string]): IncomeLine[] {
  const lines = new Map<string, IncomeLine>();
  for (const entry of entries) {
    const [id, label] = key(entry);
    const line = lines.get(id) ?? { key: id, label, amount: 0, visits: 0 };
    line.amount += entry.amountPaid;
    line.visits += 1;
    lines.set(id, line);
  }
  return [...lines.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label));
}

/** Null when she may not see income at this business. */
export async function getIncome(scope: BusinessScope, month: Month): Promise<IncomeReport | null> {
  const grant = grantFor(scope.actor.role, "revenue.view");
  if (!grant || !scope.can("revenue.view")) return null;
  const ownOnly = grant === "own";

  const business = await scope.business();
  const { first, last } = monthDays(month);
  const from = zonedTimeToUtc(first, 0, business.timeZone);
  const to = zonedTimeToUtc(addDays(last, 1), 0, business.timeZone);

  const visits = (
    await scope.select(appointments, and(gte(appointments.startsAt, from), lt(appointments.startsAt, to)))
  ).filter((appointment) => !ownOnly || appointment.professionalUserId === scope.actor.userId);

  const completed = visits.length
    ? await scope.select(
        bookings,
        and(
          inArray(
            bookings.id,
            visits.map((appointment) => appointment.bookingId),
          ),
          eq(bookings.status, "completed"),
        ),
      )
    : [];
  const [serviceRows, members] = await Promise.all([scope.select(services), scope.members()]);
  const serviceName = new Map(serviceRows.map((row) => [row.id, row.name]));
  const memberName = new Map(members.map((member) => [member.membershipId, member.displayName]));
  const byBooking = new Map(visits.map((appointment) => [appointment.bookingId, appointment]));

  const entries = completed
    .flatMap((booking): IncomeVisit[] => {
      const appointment = byBooking.get(booking.id);
      if (!appointment || booking.amountPaid === null) return [];
      return [
        {
          bookingId: booking.id,
          startsAt: appointment.startsAt,
          serviceName: serviceName.get(appointment.serviceId) ?? "",
          professionalName: appointment.membershipId
            ? (memberName.get(appointment.membershipId) ?? null)
            : null,
          customerName: booking.customerName,
          customerRecordId: booking.customerRecordId,
          amountPaid: booking.amountPaid,
          paymentMethod: booking.paymentMethod ?? "other",
        },
      ];
    })
    .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime());

  const total = entries.reduce((sum, entry) => sum + entry.amountPaid, 0);
  return {
    month,
    total,
    visits: entries.length,
    average: entries.length ? Math.round(total / entries.length) : 0,
    currency: completed[0]?.currency ?? "ETB",
    byMethod: group(entries, (entry) => [entry.paymentMethod, entry.paymentMethod]),
    byService: group(entries, (entry) => [entry.serviceName, entry.serviceName]),
    byProfessional: ownOnly
      ? []
      : group(entries, (entry) => [entry.professionalName ?? "", entry.professionalName ?? ""]),
    entries,
    ownOnly,
  };
}
