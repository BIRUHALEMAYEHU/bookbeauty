import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password";

describe("password hashing", () => {
  it("verifies the original password and rejects a wrong one", async () => {
    const hash = await hashPassword("Secret123");
    expect(await verifyPassword(hash, "Secret123")).toBe(true);
    expect(await verifyPassword(hash, "wrong")).toBe(false);
  });
});
