import "server-only";
import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import {
  availabilityExceptions,
  locationClosures,
  locations,
  memberships,
  workingHours,
  type AvailabilityException,
  type LocationClosure,
} from "@/db/schema";
import type { BusinessScope, ScopedMember } from "@/db/scope";
import { isLocalDate, zonedTimeToUtc } from "@/lib/time";

/**
 * Working hours and availability (F14), the time rules (F19) and the travel
 * buffer (F18). In Layer 1 the owner or a branch manager sets these for the
 * team (playbook 14.4); in a solo practice that is the professional herself.
 */

export type Shift = { weekday: number; startMinute: number; endMinute: number };

export type AvailabilityError =
  | "forbidden"
  | "invalid_input"
  | "member_invalid"
  | "shifts_overlap"
  | "dates_invalid"
  | "not_found";

type Failure = { ok: false; error: AvailabilityError };
type Done = { ok: true } | Failure;

export const MAX_SHIFTS_PER_DAY = 3;

const shiftSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1435).multipleOf(5),
    endMinute: z.number().int().min(5).max(1440).multipleOf(5),
  })
  .refine((shift) => shift.startMinute < shift.endMinute);

const shiftsSchema = z.array(shiftSchema).max(7 * MAX_SHIFTS_PER_DAY);

/** Members whose hours can be set: those who serve customers. */
export async function listSchedulableMembers(scope: BusinessScope): Promise<ScopedMember[]> {
  return (await scope.members()).filter((member) => member.hasProfile);
}

async function schedulableMember(scope: BusinessScope, membershipId: string) {
  if (!z.uuid().safeParse(membershipId).success) return null;
  const members = await listSchedulableMembers(scope);
  return members.find((member) => member.membershipId === membershipId) ?? null;
}

async function defaultLocation(scope: BusinessScope) {
  const [location] = await scope.select(locations, eq(locations.isDefault, true));
  if (!location) throw new Error("Business has no default location");
  return location;
}

function sortShifts(shifts: Shift[]) {
  return [...shifts].sort((a, b) => a.weekday - b.weekday || a.startMinute - b.startMinute);
}

/** Her weekly shifts, ordered by day then time. Empty means she cannot be booked. */
export async function getWeeklyHours(scope: BusinessScope, membershipId: string): Promise<Shift[]> {
  const rows = await scope.select(workingHours, eq(workingHours.membershipId, membershipId));
  return sortShifts(
    rows.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
  );
}

/** Replaces her whole week with the shifts given. */
export async function setWeeklyHours(
  scope: BusinessScope,
  membershipId: string,
  input: Shift[],
): Promise<Done> {
  if (!scope.can("staff.manage")) return { ok: false, error: "forbidden" };
  const parsed = shiftsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  const shifts = sortShifts(parsed.data);

  for (let weekday = 0; weekday < 7; weekday++) {
    const day = shifts.filter((shift) => shift.weekday === weekday);
    if (day.length > MAX_SHIFTS_PER_DAY) return { ok: false, error: "invalid_input" };
    // Sorted by start, so each shift only needs checking against the one before it.
    if (day.some((shift, index) => index > 0 && shift.startMinute < day[index - 1]!.endMinute)) {
      return { ok: false, error: "shifts_overlap" };
    }
  }

  if (!(await schedulableMember(scope, membershipId))) return { ok: false, error: "member_invalid" };
  const [location, before] = await Promise.all([
    defaultLocation(scope),
    getWeeklyHours(scope, membershipId),
  ]);

  await scope.transaction(async (scoped) => {
    await scoped.delete(workingHours, eq(workingHours.membershipId, membershipId));
    if (shifts.length > 0) {
      await scoped.insert(
        workingHours,
        shifts.map((shift) => ({ ...shift, membershipId, locationId: location.id })),
      );
    }
    await scoped.log({
      action: "working_hours.updated",
      entityType: "membership",
      entityId: membershipId,
      before: { shifts: before },
      after: { shifts },
    });
  });
  return { ok: true };
}

const periodSchema = z.object({
  startDate: z.string(),
  /** The last day included. */
  endDate: z.string(),
  /** Minutes after midnight; leave both out for whole days. */
  startMinute: z.number().int().min(0).max(1435).optional(),
  endMinute: z.number().int().min(5).max(1440).optional(),
});

/** Turns "from this day to that day, between these times" into two instants. */
function toInstants(input: z.infer<typeof periodSchema>, timeZone: string) {
  if (!isLocalDate(input.startDate) || !isLocalDate(input.endDate)) return null;
  if (input.endDate < input.startDate) return null;
  const startsAt = zonedTimeToUtc(input.startDate, input.startMinute ?? 0, timeZone);
  const endsAt = zonedTimeToUtc(input.endDate, input.endMinute ?? 1440, timeZone);
  // Longer than a year is a slip of the thumb, not a plan.
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > 366 * 86_400_000) return null;
  return { startsAt, endsAt };
}

const exceptionSchema = periodSchema.extend({
  kind: z.enum(["time_off", "extra_hours"]),
  note: z.string().trim().max(200).optional(),
});

export type ExceptionInput = z.input<typeof exceptionSchema>;

/** Time off and extra hours that have not finished yet, soonest first. */
export async function listUpcomingExceptions(
  scope: BusinessScope,
  membershipId: string,
  now = new Date(),
): Promise<AvailabilityException[]> {
  const rows = await scope.select(
    availabilityExceptions,
    and(eq(availabilityExceptions.membershipId, membershipId), gt(availabilityExceptions.endsAt, now)),
  );
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

export async function addException(
  scope: BusinessScope,
  membershipId: string,
  input: ExceptionInput,
): Promise<{ ok: true; exception: AvailabilityException } | Failure> {
  if (!scope.can("staff.manage")) return { ok: false, error: "forbidden" };
  const parsed = exceptionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };
  if (!(await schedulableMember(scope, membershipId))) return { ok: false, error: "member_invalid" };

  const business = await scope.business();
  const period = toInstants(parsed.data, business.timeZone);
  if (!period) return { ok: false, error: "dates_invalid" };

  const exception = await scope.transaction(async (scoped) => {
    const [row] = await scoped.insert(availabilityExceptions, {
      membershipId,
      kind: parsed.data.kind,
      note: parsed.data.note || null,
      ...period,
    });
    if (!row) throw new Error("Exception was not saved");
    await scoped.log({
      action: parsed.data.kind === "time_off" ? "time_off.added" : "extra_hours.added",
      entityType: "membership",
      entityId: membershipId,
      after: { startsAt: period.startsAt.toISOString(), endsAt: period.endsAt.toISOString() },
    });
    return row;
  });
  return { ok: true, exception };
}

export async function removeException(scope: BusinessScope, exceptionId: string): Promise<Done> {
  if (!scope.can("staff.manage")) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(exceptionId).success) return { ok: false, error: "not_found" };

  return scope.transaction(async (scoped): Promise<Done> => {
    const [row] = await scoped.delete(
      availabilityExceptions,
      eq(availabilityExceptions.id, exceptionId),
    );
    if (!row) return { ok: false, error: "not_found" };
    await scoped.log({
      action: row.kind === "time_off" ? "time_off.removed" : "extra_hours.removed",
      entityType: "membership",
      entityId: row.membershipId,
      before: { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() },
    });
    return { ok: true };
  });
}

const closureSchema = z.object({
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().trim().max(120).optional(),
});

export type ClosureInput = z.input<typeof closureSchema>;

/** Closed days that have not finished yet, soonest first. */
export async function listUpcomingClosures(
  scope: BusinessScope,
  now = new Date(),
): Promise<LocationClosure[]> {
  const rows = await scope.select(locationClosures, gt(locationClosures.endsAt, now));
  return rows.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
}

/** Closes the place for whole days (a holiday). Nobody can be booked then. */
export async function addClosure(
  scope: BusinessScope,
  input: ClosureInput,
): Promise<{ ok: true; closure: LocationClosure } | Failure> {
  if (!scope.can("staff.manage")) return { ok: false, error: "forbidden" };
  const parsed = closureSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const [business, location] = await Promise.all([scope.business(), defaultLocation(scope)]);
  const period = toInstants(parsed.data, business.timeZone);
  if (!period) return { ok: false, error: "dates_invalid" };

  const closure = await scope.transaction(async (scoped) => {
    const [row] = await scoped.insert(locationClosures, {
      locationId: location.id,
      reason: parsed.data.reason || null,
      ...period,
    });
    if (!row) throw new Error("Closure was not saved");
    await scoped.log({
      action: "closure.added",
      entityType: "location",
      entityId: location.id,
      after: {
        startsAt: period.startsAt.toISOString(),
        endsAt: period.endsAt.toISOString(),
        reason: row.reason,
      },
    });
    return row;
  });
  return { ok: true, closure };
}

export async function removeClosure(scope: BusinessScope, closureId: string): Promise<Done> {
  if (!scope.can("staff.manage")) return { ok: false, error: "forbidden" };
  if (!z.uuid().safeParse(closureId).success) return { ok: false, error: "not_found" };

  return scope.transaction(async (scoped): Promise<Done> => {
    const [row] = await scoped.delete(locationClosures, eq(locationClosures.id, closureId));
    if (!row) return { ok: false, error: "not_found" };
    await scoped.log({
      action: "closure.removed",
      entityType: "location",
      entityId: row.locationId,
      before: { startsAt: row.startsAt.toISOString(), endsAt: row.endsAt.toISOString() },
    });
    return { ok: true };
  });
}

/** Limits on the time rules (Section 8.10): up to a week's notice, up to a year ahead. */
const rulesSchema = z.object({
  minNoticeMinutes: z.number().int().min(0).max(7 * 24 * 60),
  maxAdvanceDays: z.number().int().min(1).max(365),
});

export type BookingRules = z.infer<typeof rulesSchema>;

export async function getBookingRules(scope: BusinessScope): Promise<BookingRules> {
  const business = await scope.business();
  return {
    minNoticeMinutes: business.minNoticeMinutes,
    maxAdvanceDays: business.maxAdvanceDays,
  };
}

/** How soon and how far ahead customers may book (F19). */
export async function updateBookingRules(scope: BusinessScope, input: BookingRules): Promise<Done> {
  if (!scope.can("settings.manage")) return { ok: false, error: "forbidden" };
  const parsed = rulesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_input" };

  const before = await getBookingRules(scope);
  await scope.transaction(async (scoped) => {
    await scoped.updateBusiness(parsed.data);
    await scoped.log({
      action: "booking_rules.updated",
      entityType: "business",
      entityId: scope.businessId,
      before,
      after: parsed.data,
    });
  });
  return { ok: true };
}

export async function getTravelBuffer(scope: BusinessScope, membershipId: string): Promise<number> {
  const [row] = await scope.select(memberships, eq(memberships.id, membershipId));
  return row?.travelBufferMinutes ?? 0;
}

/** Time blocked after a visit to a customer's place, chosen by her, not worked out from a map (F18). */
export async function setTravelBuffer(
  scope: BusinessScope,
  membershipId: string,
  minutes: number,
): Promise<Done> {
  if (!scope.can("staff.manage")) return { ok: false, error: "forbidden" };
  if (!z.number().int().min(0).max(240).multipleOf(5).safeParse(minutes).success) {
    return { ok: false, error: "invalid_input" };
  }
  if (!(await schedulableMember(scope, membershipId))) return { ok: false, error: "member_invalid" };

  const before = await getTravelBuffer(scope, membershipId);
  if (before === minutes) return { ok: true };
  await scope.transaction(async (scoped) => {
    await scoped.update(
      memberships,
      { travelBufferMinutes: minutes, updatedAt: new Date() },
      eq(memberships.id, membershipId),
    );
    await scoped.log({
      action: "travel_buffer.updated",
      entityType: "membership",
      entityId: membershipId,
      before: { travelBufferMinutes: before },
      after: { travelBufferMinutes: minutes },
    });
  });
  return { ok: true };
}

/** Every member's week at once, for working out open times. */
export async function getAllWeeklyHours(scope: BusinessScope): Promise<Map<string, Shift[]>> {
  const rows = await scope.select(workingHours);
  const byMember = new Map<string, Shift[]>();
  for (const { membershipId, weekday, startMinute, endMinute } of rows) {
    const list = byMember.get(membershipId) ?? [];
    list.push({ weekday, startMinute, endMinute });
    byMember.set(membershipId, list);
  }
  for (const [id, list] of byMember) byMember.set(id, sortShifts(list));
  return byMember;
}
