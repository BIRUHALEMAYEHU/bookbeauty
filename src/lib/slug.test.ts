import { describe, expect, it } from "vitest";
import { isReservedName, normaliseSlug } from "./slug";

describe("normaliseSlug", () => {
  it("lowercases and strips a leading @", () => {
    expect(normaliseSlug("@MeronHair")).toBe("meronhair");
  });

  it("turns spaces and underscores into hyphens", () => {
    expect(normaliseSlug("Beauty Lounge")).toBe("beauty-lounge");
    expect(normaliseSlug("beauty_lounge")).toBe("beauty-lounge");
  });

  it("rejects reserved words", () => {
    expect(normaliseSlug("login")).toBeNull();
    expect(normaliseSlug("admin")).toBeNull();
  });

  it("rejects too-short, too-long, or digit-only values", () => {
    expect(normaliseSlug("a")).toBeNull();
    expect(normaliseSlug("a".repeat(41))).toBeNull();
    expect(normaliseSlug("12345")).toBeNull();
  });

  it("rejects characters outside a-z, 0-9 and hyphens", () => {
    expect(normaliseSlug("meron!")).toBeNull();
    expect(normaliseSlug("meron.hair")).toBeNull();
  });
});

describe("isReservedName", () => {
  it("is case-insensitive", () => {
    expect(isReservedName("Login")).toBe(true);
    expect(isReservedName("meron")).toBe(false);
  });
});
