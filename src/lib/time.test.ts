import { describe, expect, it } from "vitest";
import {
  addDays,
  formatDate,
  formatDateTime,
  formatTime,
  formatTimeOfDay,
  isLocalDate,
  localDateOf,
  minuteOfDay,
  weekdayOf,
  zonedTimeToUtc,
} from "./time";

describe("times of day and local dates", () => {
  it("shows minutes after midnight with AM or PM", () => {
    expect(formatTimeOfDay(540)).toBe("9:00 AM");
    expect(formatTimeOfDay(750)).toBe("12:30 PM");
    expect(formatTimeOfDay(0)).toBe("12:00 AM");
    expect(formatTimeOfDay(1440)).toBe("12:00 AM");
  });

  it("turns a day and time on the Addis clock into an instant, and back", () => {
    const nine = zonedTimeToUtc("2026-10-27", 540);
    expect(nine.toISOString()).toBe("2026-10-27T06:00:00.000Z");
    expect(localDateOf(nine)).toBe("2026-10-27");
    expect(minuteOfDay(nine)).toBe(540);

    // Midnight belongs to the new day; the end of a day is the next day's start.
    expect(zonedTimeToUtc("2026-10-27", 0).toISOString()).toBe("2026-10-26T21:00:00.000Z");
    expect(zonedTimeToUtc("2026-10-27", 1440)).toEqual(zonedTimeToUtc("2026-10-28", 0));
    expect(localDateOf(new Date("2026-10-26T21:00:00Z"))).toBe("2026-10-27");
    expect(localDateOf(new Date("2026-10-26T20:59:59Z"))).toBe("2026-10-26");
  });

  it("handles a zone whose clocks change", () => {
    // New York leaves daylight saving on 1 November 2026: 9 AM is UTC-4 before, UTC-5 after.
    expect(zonedTimeToUtc("2026-10-31", 540, "America/New_York").toISOString()).toBe(
      "2026-10-31T13:00:00.000Z",
    );
    expect(zonedTimeToUtc("2026-11-01", 540, "America/New_York").toISOString()).toBe(
      "2026-11-01T14:00:00.000Z",
    );
  });

  it("knows weekdays and real dates", () => {
    expect(weekdayOf("2026-10-27")).toBe(2); // a Tuesday
    expect(weekdayOf("2026-11-01")).toBe(0); // a Sunday
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(isLocalDate("2026-02-28")).toBe(true);
    expect(isLocalDate("2026-02-30")).toBe(false);
    expect(isLocalDate("27/10/2026")).toBe(false);
  });
});

// 06:00 UTC is 9:00 AM in Addis Ababa (UTC+3, no daylight saving).
const nineAmInAddis = new Date("2026-10-27T06:00:00Z");

describe("formatTime", () => {
  it("always includes AM or PM", () => {
    expect(formatTime(nineAmInAddis)).toBe("9:00 AM");
    expect(formatTime(new Date("2026-10-27T12:30:00Z"))).toBe("3:30 PM");
  });

  it("shows midnight and noon unambiguously", () => {
    expect(formatTime(new Date("2026-10-26T21:00:00Z"))).toBe("12:00 AM");
    expect(formatTime(new Date("2026-10-27T09:00:00Z"))).toBe("12:00 PM");
  });

  it("uses only plain spaces", () => {
    expect(formatTime(nineAmInAddis)).not.toMatch(/[\u202f\u00a0]/);
  });

  it("respects the time zone", () => {
    expect(formatTime(nineAmInAddis, "UTC")).toBe("6:00 AM");
  });
});

describe("formatDate", () => {
  it("uses the Gregorian calendar in the local time zone", () => {
    expect(formatDate(nineAmInAddis)).toBe("Tue, 27 Oct 2026");
    // 22:00 UTC on the 26th is already the 27th in Addis Ababa.
    expect(formatDate(new Date("2026-10-26T22:00:00Z"))).toBe("Tue, 27 Oct 2026");
  });
});

describe("formatDateTime", () => {
  it("combines date and time", () => {
    expect(formatDateTime(nineAmInAddis)).toBe("Tue, 27 Oct 2026, 9:00 AM");
  });
});
