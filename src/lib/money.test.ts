import { describe, expect, it } from "vitest";
import { formatMoney, toMinorUnits } from "./money";

describe("money", () => {
  it("formats whole birr without decimals", () => {
    expect(formatMoney({ amount: 120000, currency: "ETB" })).toBe("1,200 ETB");
  });

  it("formats santim when present", () => {
    expect(formatMoney({ amount: 125050, currency: "ETB" })).toBe("1,250.50 ETB");
  });

  it("converts birr to santim without floating-point drift", () => {
    expect(toMinorUnits(19.99)).toBe(1999);
  });

  it("rejects fractional minor units", () => {
    expect(() => formatMoney({ amount: 1.5, currency: "ETB" })).toThrow();
  });
});
