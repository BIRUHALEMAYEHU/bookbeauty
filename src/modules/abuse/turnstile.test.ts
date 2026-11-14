import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

function cloudflareAnswers(body: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => body }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verifyTurnstileToken", () => {
  it("lets everything through when no secret is configured", async () => {
    const fetchMock = cloudflareAnswers({ success: false });
    expect(await verifyTurnstileToken(null, null, undefined)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing token without calling Cloudflare", async () => {
    const fetchMock = cloudflareAnswers({ success: true });
    expect(await verifyTurnstileToken("", "1.2.3.4", "secret")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts a token Cloudflare confirms, sending the secret and IP", async () => {
    const fetchMock = cloudflareAnswers({ success: true });
    expect(await verifyTurnstileToken("token", "1.2.3.4", "secret")).toBe(true);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }];
    expect(init.body.get("secret")).toBe("secret");
    expect(init.body.get("response")).toBe("token");
    expect(init.body.get("remoteip")).toBe("1.2.3.4");
  });

  it("rejects a token Cloudflare refuses", async () => {
    cloudflareAnswers({ success: false });
    expect(await verifyTurnstileToken("token", null, "secret")).toBe(false);
  });

  it("fails closed when Cloudflare errors or cannot be reached", async () => {
    cloudflareAnswers({}, false);
    expect(await verifyTurnstileToken("token", null, "secret")).toBe(false);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    expect(await verifyTurnstileToken("token", null, "secret")).toBe(false);
  });
});
