import { describe, expect, it } from "vitest";
import { formatDate, formatDateTime, formatTime } from "./time";

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
