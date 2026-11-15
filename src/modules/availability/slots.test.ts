import { describe, expect, it } from "vitest";
import { formatTime, zonedTimeToUtc } from "@/lib/time";
import { openSlots, type Period, type ProfessionalDay, type SlotRequest } from "./slots";

const TZ = "Africa/Addis_Ababa";
// Tuesday 27 October 2026. "Now" is the Sunday before, at noon, so notice never interferes.
const TUESDAY = "2026-10-27";
const now = zonedTimeToUtc("2026-10-25", 720, TZ);

/** A stretch of Tuesday on the Addis clock, in minutes after midnight. */
function at(startMinute: number, endMinute: number, date = TUESDAY): Period {
  return { startsAt: zonedTimeToUtc(date, startMinute, TZ), endsAt: zonedTimeToUtc(date, endMinute, TZ) };
}

function hana(overrides: Partial<ProfessionalDay> = {}): ProfessionalDay {
  return {
    membershipId: "hana",
    // Tuesday 9:00 AM to 12:00 PM.
    shifts: [{ weekday: 2, startMinute: 540, endMinute: 720 }],
    timeOff: [],
    extraHours: [],
    busy: [],
    ...overrides,
  };
}

function request(overrides: Partial<SlotRequest> = {}): SlotRequest {
  return {
    date: TUESDAY,
    timeZone: TZ,
    now,
    durationMinutes: 60,
    bufferMinutes: 0,
    minNoticeMinutes: 120,
    maxAdvanceDays: 60,
    closures: [],
    professionals: [hana()],
    ...overrides,
  };
}

const times = (slots: ReturnType<typeof openSlots>) =>
  slots.map((slot) => formatTime(slot.startsAt, TZ));

describe("openSlots", () => {
  it("offers every quarter hour the service fits inside her shift", () => {
    expect(times(openSlots(request()))).toEqual([
      "9:00 AM",
      "9:15 AM",
      "9:30 AM",
      "9:45 AM",
      "10:00 AM",
      "10:15 AM",
      "10:30 AM",
      "10:45 AM",
      "11:00 AM",
    ]);
  });

  it("offers nothing on a day she does not work, or when the service is longer than her shift", () => {
    expect(openSlots(request({ date: "2026-10-28" }))).toEqual([]);
    expect(openSlots(request({ durationMinutes: 240 }))).toEqual([]);
  });

  it("does not offer a service across a break", () => {
    const split = hana({
      shifts: [
        { weekday: 2, startMinute: 540, endMinute: 630 },
        { weekday: 2, startMinute: 690, endMinute: 780 },
      ],
    });
    expect(times(openSlots(request({ professionals: [split] })))).toEqual([
      "9:00 AM",
      "9:15 AM",
      "9:30 AM",
      "11:30 AM",
      "11:45 AM",
      "12:00 PM",
    ]);
  });

  it("works around an existing appointment and the free time after the new one", () => {
    const booked = hana({ busy: [at(600, 660)] }); // 10:00 to 11:00 AM
    expect(times(openSlots(request({ professionals: [booked], durationMinutes: 30 })))).toEqual([
      "9:00 AM",
      "9:15 AM",
      "9:30 AM",
      "11:00 AM",
      "11:15 AM",
      "11:30 AM",
    ]);
    // With 15 minutes needed afterwards, 9:30 no longer fits before the 10:00 appointment.
    expect(
      times(openSlots(request({ professionals: [booked], durationMinutes: 30, bufferMinutes: 15 }))),
    ).toEqual(["9:00 AM", "9:15 AM", "11:00 AM", "11:15 AM", "11:30 AM"]);
  });

  it("lets the free time after the last service run past the end of her day", () => {
    const slots = times(openSlots(request({ bufferMinutes: 30 })));
    expect(slots.at(-1)).toBe("11:00 AM");
  });

  it("removes time off and closures", () => {
    expect(
      times(openSlots(request({ professionals: [hana({ timeOff: [at(540, 660)] })] }))),
    ).toEqual(["11:00 AM"]);
    expect(openSlots(request({ closures: [at(0, 1440)] }))).toEqual([]);
  });

  it("adds extra hours on a day she is usually off", () => {
    const wednesday = "2026-10-28";
    const extra = hana({ extraHours: [at(840, 930, wednesday)] }); // 2:00 to 3:30 PM
    expect(times(openSlots(request({ date: wednesday, professionals: [extra] })))).toEqual([
      "2:00 PM",
      "2:15 PM",
      "2:30 PM",
    ]);
  });

  it("respects the shortest notice", () => {
    const nineThirty = zonedTimeToUtc(TUESDAY, 570, TZ);
    // At 9:30 AM with 60 minutes' notice, the first bookable start is 10:30 AM.
    expect(times(openSlots(request({ now: nineThirty, minNoticeMinutes: 60 })))).toEqual([
      "10:30 AM",
      "10:45 AM",
      "11:00 AM",
    ]);
    // With no notice needed, the earliest start is right now; earlier times are gone.
    expect(times(openSlots(request({ now: nineThirty, minNoticeMinutes: 0 })))[0]).toBe("9:30 AM");
  });

  it("respects how far ahead customers may book, and never offers the past", () => {
    expect(openSlots(request({ maxAdvanceDays: 1 }))).toEqual([]);
    expect(openSlots(request({ maxAdvanceDays: 2 }))).toHaveLength(9);
    expect(openSlots(request({ date: "2026-10-20" }))).toEqual([]);
  });

  it("for any available, offers a time when at least one professional is free", () => {
    const meron: ProfessionalDay = {
      membershipId: "meron",
      shifts: [{ weekday: 2, startMinute: 660, endMinute: 780 }], // 11:00 AM to 1:00 PM
      timeOff: [],
      extraHours: [],
      busy: [],
    };
    const slots = openSlots(
      request({ professionals: [hana({ busy: [at(540, 660)] }), meron] }),
    );
    expect(times(slots)).toEqual(["11:00 AM", "11:15 AM", "11:30 AM", "11:45 AM", "12:00 PM"]);
    expect(slots[0]?.membershipIds).toEqual(["hana", "meron"]);
    expect(slots.at(-1)?.membershipIds).toEqual(["meron"]);
  });

  it("offers nothing when nobody can perform the service", () => {
    expect(openSlots(request({ professionals: [] }))).toEqual([]);
  });
});
