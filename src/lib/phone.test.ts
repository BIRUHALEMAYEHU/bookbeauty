import { describe, expect, it } from "vitest";
import { formatPhone, normaliseContactPhone, normalisePhone } from "./phone";

describe("normalisePhone", () => {
  it.each([
    "0911234567",
    "0911 23 45 67",
    "091-123-4567",
    "911234567",
    "251911234567",
    "+251911234567",
    "+251 91 123 4567",
  ])("treats %s as the same Ethio Telecom number", (input) => {
    expect(normalisePhone(input)).toBe("+251911234567");
  });

  it("accepts Safaricom numbers starting with 7", () => {
    expect(normalisePhone("0712345678")).toBe("+251712345678");
  });

  it.each(["", "abc", "091123456", "09112345678", "0811234567", "+251811234567"])(
    "rejects %s",
    (input) => {
      expect(normalisePhone(input)).toBeNull();
    },
  );

  it("accepts international numbers written with +", () => {
    expect(normalisePhone("+44 20 7946 0958")).toBe("+442079460958");
  });

  it("does not guess the country for numbers without + or a local prefix", () => {
    expect(normalisePhone("442079460958")).toBeNull();
  });
});

describe("normaliseContactPhone", () => {
  it("accepts mobiles and Ethiopian landlines", () => {
    expect(normaliseContactPhone("0911 23 45 67")).toBe("+251911234567");
    expect(normaliseContactPhone("011 123 4567")).toBe("+251111234567");
    expect(normaliseContactPhone("+251 11 123 4567")).toBe("+251111234567");
    expect(normaliseContactPhone("0221 12 34 56")).toBe("+251221123456");
  });

  it("rejects numbers that are neither", () => {
    expect(normaliseContactPhone("061 123 4567")).toBeNull();
    expect(normaliseContactPhone("12345")).toBeNull();
    expect(normaliseContactPhone("011-ABC")).toBeNull();
  });

  it("keeps customer matching mobile-only", () => {
    expect(normalisePhone("011 123 4567")).toBeNull();
  });
});

describe("formatPhone", () => {
  it("shows Ethiopian numbers the way people write them", () => {
    expect(formatPhone("+251911234567")).toBe("0911 23 45 67");
    expect(formatPhone("+251111234567")).toBe("011 123 4567");
    expect(formatPhone("+447700900123")).toBe("+447700900123");
  });
});
