/** The words for a length of time live in en.json under "common" (F06). */
type DurationText = (
  key: "durationHours" | "durationMinutes" | "durationHoursMinutes",
  values: { hours?: number; minutes?: number },
) => string;

/** "45 min", "2 hr" or "2 hr 30 min". `t` is the translator for the "common" section. */
export function formatDuration(totalMinutes: number, t: DurationText): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return t("durationMinutes", { minutes });
  if (minutes === 0) return t("durationHours", { hours });
  return t("durationHoursMinutes", { hours, minutes });
}

/**
 * Lengths offered when setting up a service: every 15 minutes up to 4 hours,
 * then every 30 minutes up to 12 (braiding can take most of a day).
 */
export function durationChoices(): number[] {
  const choices: number[] = [];
  for (let minutes = 15; minutes <= 240; minutes += 15) choices.push(minutes);
  for (let minutes = 270; minutes <= 720; minutes += 30) choices.push(minutes);
  return choices;
}

/** Free time after a service (D34). */
export const BUFFER_CHOICES = [0, 5, 10, 15, 20, 30, 45, 60];
