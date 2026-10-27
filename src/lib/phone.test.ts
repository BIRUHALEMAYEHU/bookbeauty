import { describe, expect, it } from "vitest";
import { normalisePhone } from "./phone";

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
