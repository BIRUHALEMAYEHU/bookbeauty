import { describe, expect, it } from "vitest";
import en from "@/messages/en.json";
import { BUFFER_CHOICES, durationChoices, formatDuration } from "./duration";

/** Fills the "common" wording the way the app's translator would. */
const t = (key: keyof typeof en.common, values: { hours?: number; minutes?: number }) =>
  en.common[key]
    .replace("{hours}", String(values.hours))
    .replace("{minutes}", String(values.minutes));

describe("formatDuration", () => {
  it("writes minutes, hours, or both", () => {
    expect(formatDuration(45, t)).toBe("45 min");
    expect(formatDuration(120, t)).toBe("2 hr");
    expect(formatDuration(150, t)).toBe("2 hr 30 min");
  });
});

describe("duration choices", () => {
  it("fit the 15-minute booking grid and the service limits", () => {
    const choices = durationChoices();
    expect(choices[0]).toBe(15);
    expect(choices.at(-1)).toBe(720);
    expect(choices.every((minutes) => minutes % 15 === 0)).toBe(true);
    expect(new Set(choices).size).toBe(choices.length);
    expect(BUFFER_CHOICES.every((minutes) => minutes % 5 === 0)).toBe(true);
  });
});
