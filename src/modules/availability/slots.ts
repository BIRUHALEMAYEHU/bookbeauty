import { addDays, localDateOf, weekdayOf, zonedTimeToUtc, type LocalDate } from "@/lib/time";

/**
 * Works out the times a customer can book on one day (technical-plan
 * Section 6). A pure function: everything it needs is passed in, it reads
 * nothing and writes nothing, so it can be tested with fixed inputs. The
 * database rule against double-booking is still the final word when a
 * booking is made; this only decides what to offer.
 */

/** Start times are offered every 15 minutes on the place's own clock. */
export const SLOT_GRID_MINUTES = 15;

export type Period = { startsAt: Date; endsAt: Date };

export type ProfessionalDay = {
  membershipId: string;
  /** Her weekly shifts (any weekday; the ones for the day asked about are used). */
  shifts: { weekday: number; startMinute: number; endMinute: number }[];
  timeOff: Period[];
  extraHours: Period[];
  /**
   * When she is already taken: her appointments at any business, each
   * including the free time after it, and busy blocks from her calendars.
   */
  busy: Period[];
};

export type SlotRequest = {
  date: LocalDate;
  timeZone: string;
  now: Date;
  durationMinutes: number;
  /** Free time after the service, plus her travel time for a visit to the customer's place. */
  bufferMinutes: number;
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  /** Times the whole place is closed. */
  closures: Period[];
  /** The professionals who can perform the service: one for a chosen professional, several for "Any available". */
  professionals: ProfessionalDay[];
};

export type Slot = {
  startsAt: Date;
  /** Who is free then, in the order they were given. */
  membershipIds: string[];
};

type Span = { start: number; end: number };

const MINUTE = 60_000;

function toSpan(period: Period): Span {
  return { start: period.startsAt.getTime(), end: period.endsAt.getTime() };
}

/** Joins spans that touch or overlap. */
function merge(spans: Span[]): Span[] {
  const sorted = spans.filter((span) => span.end > span.start).sort((a, b) => a.start - b.start);
  const merged: Span[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

/** What is left of the spans once the blocked times are cut out. */
function subtract(spans: Span[], blocked: Span[]): Span[] {
  let remaining = spans;
  for (const block of blocked) {
    remaining = remaining.flatMap((span) => {
      if (block.end <= span.start || block.start >= span.end) return [span];
      const pieces: Span[] = [];
      if (block.start > span.start) pieces.push({ start: span.start, end: block.start });
      if (block.end < span.end) pieces.push({ start: block.end, end: span.end });
      return pieces;
    });
  }
  return remaining;
}

/** The stretches of the day she is at work: her shifts and extra hours, less time off and closures. */
function workingSpans(professional: ProfessionalDay, request: SlotRequest, day: Span): Span[] {
  const weekday = weekdayOf(request.date);
  const shifts = professional.shifts
    .filter((shift) => shift.weekday === weekday)
    .map((shift) => ({
      start: zonedTimeToUtc(request.date, shift.startMinute, request.timeZone).getTime(),
      end: zonedTimeToUtc(request.date, shift.endMinute, request.timeZone).getTime(),
    }));
  const extra = professional.extraHours
    .map(toSpan)
    .map((span) => ({ start: Math.max(span.start, day.start), end: Math.min(span.end, day.end) }));

  return subtract(merge([...shifts, ...extra]), [
    ...professional.timeOff.map(toSpan),
    ...request.closures.map(toSpan),
  ]);
}

/**
 * The start times open on the requested day, earliest first. With several
 * professionals, a time is offered when at least one of them is free (D84).
 *
 * The service itself must fit inside her working time. The free time after
 * it may run past the end of her day, but must not run into anything else
 * she has.
 */
export function openSlots(request: SlotRequest): Slot[] {
  const today = localDateOf(request.now, request.timeZone);
  if (request.date < today || request.date > addDays(today, request.maxAdvanceDays)) return [];
  if (request.durationMinutes <= 0) return [];

  const day: Span = {
    start: zonedTimeToUtc(request.date, 0, request.timeZone).getTime(),
    end: zonedTimeToUtc(request.date, 1440, request.timeZone).getTime(),
  };
  const earliest = request.now.getTime() + request.minNoticeMinutes * MINUTE;
  const duration = request.durationMinutes * MINUTE;
  const buffer = Math.max(0, request.bufferMinutes) * MINUTE;

  const free = new Map<number, string[]>();
  for (const professional of request.professionals) {
    const working = workingSpans(professional, request, day);
    if (working.length === 0) continue;
    const busy = professional.busy.map(toSpan);

    for (let minute = 0; minute < 1440; minute += SLOT_GRID_MINUTES) {
      const start = zonedTimeToUtc(request.date, minute, request.timeZone).getTime();
      const end = start + duration;
      if (start < earliest) continue;
      if (!working.some((span) => span.start <= start && end <= span.end)) continue;
      if (busy.some((span) => span.start < end + buffer && start < span.end)) continue;

      const list = free.get(start);
      if (list) list.push(professional.membershipId);
      else free.set(start, [professional.membershipId]);
    }
  }

  return [...free.entries()]
    .sort(([a], [b]) => a - b)
    .map(([start, membershipIds]) => ({ startsAt: new Date(start), membershipIds }));
}
