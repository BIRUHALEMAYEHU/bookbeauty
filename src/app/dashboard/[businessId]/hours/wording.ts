import "server-only";
import { getTranslations } from "next-intl/server";
import { formatDuration } from "@/lib/duration";
import { formatDate, formatDateTime, formatTimeOfDay, minuteOfDay } from "@/lib/time";

type Shift = { weekday: number; startMinute: number; endMinute: number };

/** Weekday names, Sunday first, as weekdays are numbered. */
export async function weekdayNames(): Promise<string[]> {
  const t = await getTranslations("common");
  return [
    t("weekday0"),
    t("weekday1"),
    t("weekday2"),
    t("weekday3"),
    t("weekday4"),
    t("weekday5"),
    t("weekday6"),
  ];
}

/** One line per working day, Monday first: "Monday" and "9:00 AM to 6:00 PM". */
export async function weekSummary(shifts: Shift[]) {
  const t = await getTranslations("hours");
  const names = await weekdayNames();
  return [1, 2, 3, 4, 5, 6, 0]
    .map((weekday) => ({
      day: names[weekday]!,
      times: shifts
        .filter((shift) => shift.weekday === weekday)
        .map((shift) =>
          t("range", {
            start: formatTimeOfDay(shift.startMinute),
            end: formatTimeOfDay(shift.endMinute),
          }),
        ),
    }))
    .filter((line) => line.times.length > 0);
}

/** A stretch of time off or a closure: whole days read as dates, anything else with its times. */
export async function describePeriod(startsAt: Date, endsAt: Date, timeZone: string) {
  const t = await getTranslations("hours");
  const wholeDays = minuteOfDay(startsAt, timeZone) === 0 && minuteOfDay(endsAt, timeZone) === 0;
  if (!wholeDays) {
    return t("range", {
      start: formatDateTime(startsAt, timeZone),
      end: formatDateTime(endsAt, timeZone),
    });
  }
  const first = formatDate(startsAt, timeZone);
  // The period ends at midnight, which belongs to the day after the last day off.
  const last = formatDate(new Date(endsAt.getTime() - 1), timeZone);
  return first === last ? first : t("range", { start: first, end: last });
}

const NOTICE_MINUTES = [0, 60, 120, 240, 720, 1440, 2880];
const ADVANCE_DAYS = [7, 14, 30, 60, 90, 180];
const TRAVEL_MINUTES = [0, 15, 30, 45, 60, 90, 120];

function withCurrent(list: number[], value: number) {
  return list.includes(value) ? list : [...list, value].sort((a, b) => a - b);
}

/** The lists for the booking rules form, already worded. */
export async function ruleChoices(current: {
  minNoticeMinutes: number;
  maxAdvanceDays: number;
  travelBufferMinutes: number;
}) {
  const [t, tCommon] = await Promise.all([getTranslations("hours"), getTranslations("common")]);
  return {
    notice: withCurrent(NOTICE_MINUTES, current.minNoticeMinutes).map((value) => ({
      value,
      label:
        value === 0
          ? t("noNotice")
          : value % 1440 === 0
            ? t("days", { count: value / 1440 })
            : formatDuration(value, tCommon),
    })),
    advance: withCurrent(ADVANCE_DAYS, current.maxAdvanceDays).map((value) => ({
      value,
      label: t("days", { count: value }),
    })),
    travel: withCurrent(TRAVEL_MINUTES, current.travelBufferMinutes).map((value) => ({
      value,
      label: value === 0 ? t("none") : formatDuration(value, tCommon),
    })),
  };
}
