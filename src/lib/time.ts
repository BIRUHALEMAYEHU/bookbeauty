export const DEFAULT_TIME_ZONE = "Africa/Addis_Ababa";

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, options: Intl.DateTimeFormatOptions) {
  const key = `${timeZone}|${JSON.stringify(options)}`;
  let cached = formatterCache.get(key);
  if (!cached) {
    cached = new Intl.DateTimeFormat("en-GB", { timeZone, ...options });
    formatterCache.set(key, cached);
  }
  return cached;
}

// ICU separates "AM"/"PM" with a narrow no-break space, which some phone fonts render badly.
function normaliseSpaces(text: string) {
  return text.replace(/[\u202f\u00a0]/g, " ");
}

/**
 * "9:00 AM". Every time shown to a user must include AM or PM (D87): many
 * Ethiopians read a bare "3:00" on the local clock, which is 9 AM.
 */
export function formatTime(instant: Date, timeZone = DEFAULT_TIME_ZONE) {
  const parts = formatter(timeZone, {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(instant);

  const hour = parts.find((p) => p.type === "hour")?.value;
  const minute = parts.find((p) => p.type === "minute")?.value;
  const period = parts.find((p) => p.type === "dayPeriod")?.value;
  if (!hour || !minute || !period) {
    throw new Error("Could not format time");
  }
  return `${Number(hour)}:${minute} ${period.toUpperCase()}`;
}

/** "Tue, 27 Oct 2026". Gregorian calendar only (D86). */
export function formatDate(instant: Date, timeZone = DEFAULT_TIME_ZONE) {
  return normaliseSpaces(
    formatter(timeZone, {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(instant),
  );
}

/** "Tue, 27 Oct 2026, 9:00 AM" */
export function formatDateTime(instant: Date, timeZone = DEFAULT_TIME_ZONE) {
  return `${formatDate(instant, timeZone)}, ${formatTime(instant, timeZone)}`;
}

/**
 * A time of day stored as minutes after midnight (working hours), shown as
 * "9:00 AM". 1440, the end of the day, reads "12:00 AM".
 */
export function formatTimeOfDay(minutes: number) {
  return formatTime(new Date(Date.UTC(2000, 0, 1, 0, minutes)), "UTC");
}

/** A calendar day on some place's own clock, as "2026-10-27". */
export type LocalDate = string;

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True for a real Gregorian day written "YYYY-MM-DD" (not 2026-02-30). */
export function isLocalDate(text: string): text is LocalDate {
  const match = LOCAL_DATE.exec(text);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function dateParts(date: LocalDate) {
  const match = LOCAL_DATE.exec(date);
  if (!match) throw new Error(`Not a date: ${date}`);
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

/** How far the zone's clock is ahead of UTC at that instant, in milliseconds. */
function zoneOffsetMs(instant: Date, timeZone: string) {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a place's clock shows the given day and time of day.
 * Minutes may be 1440 (midnight ending the day).
 */
export function zonedTimeToUtc(date: LocalDate, minutes: number, timeZone = DEFAULT_TIME_ZONE) {
  const { year, month, day } = dateParts(date);
  const wallClock = Date.UTC(year, month - 1, day, 0, minutes);
  // Two passes, so a zone whose offset changes that day still lands on the right instant.
  const first = wallClock - zoneOffsetMs(new Date(wallClock), timeZone);
  return new Date(wallClock - zoneOffsetMs(new Date(first), timeZone));
}

/** The calendar day a place's clock shows at that instant. */
export function localDateOf(instant: Date, timeZone = DEFAULT_TIME_ZONE): LocalDate {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return local.toISOString().slice(0, 10);
}

/** Minutes after midnight on a place's clock at that instant. */
export function minuteOfDay(instant: Date, timeZone = DEFAULT_TIME_ZONE) {
  const local = new Date(instant.getTime() + zoneOffsetMs(instant, timeZone));
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

/** "November 2026" for "2026-11". Gregorian only (D86). */
export function formatMonth(month: string) {
  const [year, m] = month.split("-").map(Number) as [number, number];
  return formatter("UTC", { month: "long", year: "numeric" }).format(new Date(Date.UTC(year, m - 1, 15)));
}

/** A calendar day in two short pieces, for a row of day buttons: "Tue" and "27 Oct". */
export function formatShortDay(date: LocalDate) {
  const { year, month, day } = dateParts(date);
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  return {
    weekday: formatter("UTC", { weekday: "short" }).format(noon),
    day: normaliseSpaces(formatter("UTC", { day: "numeric", month: "short" }).format(noon)),
  };
}

/** 0 is Sunday, 6 is Saturday. */
export function weekdayOf(date: LocalDate) {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const { year, month, day } = dateParts(date);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
