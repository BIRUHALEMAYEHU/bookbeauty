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
