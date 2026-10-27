import { describe, expect, it } from "vitest";
import { consumeRateLimit } from "./rate-limit";

describe("consumeRateLimit", () => {
  it("allows requests up to the limit, then blocks", async () => {
    const key = `test:limit:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const policy = { key, limit: 3, windowSeconds: 60 };

    expect((await consumeRateLimit(policy)).ok).toBe(true);
    expect((await consumeRateLimit(policy)).ok).toBe(true);
    const third = await consumeRateLimit(policy);
    expect(third.ok).toBe(true);
    if (third.ok) expect(third.remaining).toBe(0);

    const blocked = await consumeRateLimit(policy);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });
});
