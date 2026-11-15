import { describe, expect, it } from "vitest";
import { areaForPath, areasForHost, decideRoute, readHostConfig, type HostConfig } from "./hosts";

const split: HostConfig = {
  site: "https://teamflow.cyou",
  app: "https://app.teamflow.cyou",
  admin: "https://admin.teamflow.cyou",
};
const SITE = "teamflow.cyou";
const APP = "app.teamflow.cyou";
const ADMIN = "admin.teamflow.cyou";

const go = (host: string, path: string, search = "") => decideRoute(host, path, search, split);
const cont = { action: "continue" };
const notFound = { action: "notFound" };
const redirect = (to: string) => ({ action: "redirect", to });

describe("readHostConfig", () => {
  it("serves everything together when only APP_URL is set", () => {
    const config = readHostConfig({ APP_URL: "http://localhost:3000/" });
    expect(config).toEqual({
      app: "http://localhost:3000",
      site: "http://localhost:3000",
      admin: "http://localhost:3000",
    });
    for (const path of ["/", "/login", "/admin", "/beauty-lounge", "/dashboard"]) {
      expect(decideRoute("localhost:3000", path, "", config)).toEqual(cont);
    }
  });

  it("ignores a broken value instead of crashing", () => {
    expect(readHostConfig({ APP_URL: "https://app.example.com", SITE_URL: "not a url" }).site).toBe(
      "https://app.example.com",
    );
  });
});

describe("paths and hosts", () => {
  it("sorts paths into areas", () => {
    expect(areaForPath("/")).toBe("site");
    expect(areaForPath("/beauty-lounge")).toBe("site");
    expect(areaForPath("/@hana")).toBe("site");
    expect(areaForPath("/administrator")).toBe("site");
    expect(areaForPath("/login")).toBe("app");
    expect(areaForPath("/dashboard/abc/activity")).toBe("app");
    expect(areaForPath("/api/auth/google/callback")).toBe("app");
    expect(areaForPath("/admin")).toBe("admin");
    expect(areaForPath("/admin/users")).toBe("admin");
  });

  it("matches hosts without regard to letter case", () => {
    expect(areasForHost("APP.teamflow.cyou", split)).toEqual(["app"]);
    expect(areasForHost("evil.example.com", split)).toEqual([]);
    expect(areasForHost(null, split)).toEqual([]);
  });
});

describe("main domain", () => {
  it("serves the home page and public pages", () => {
    expect(go(SITE, "/")).toEqual(cont);
    expect(go(SITE, "/beauty-lounge")).toEqual(cont);
    expect(go(SITE, "/@hana")).toEqual(cont);
  });

  it("sends app pages to the app address, keeping the query", () => {
    expect(go(SITE, "/login")).toEqual(redirect("https://app.teamflow.cyou/login"));
    expect(go(SITE, "/reset-password", "?token=abc")).toEqual(
      redirect("https://app.teamflow.cyou/reset-password?token=abc"),
    );
  });

  it("has no admin area", () => {
    expect(go(SITE, "/admin")).toEqual(notFound);
    expect(go(SITE, "/admin/users")).toEqual(notFound);
  });
});

describe("app address", () => {
  it("serves login, onboarding and the dashboard", () => {
    for (const path of ["/login", "/signup", "/onboarding/salon", "/dashboard", "/account", "/api/auth/verify-email"]) {
      expect(go(APP, path)).toEqual(cont);
    }
  });

  it("opens the dashboard from its front page and sends public pages to the main domain", () => {
    expect(go(APP, "/")).toEqual(redirect("https://app.teamflow.cyou/dashboard"));
    expect(go(APP, "/beauty-lounge")).toEqual(redirect("https://teamflow.cyou/beauty-lounge"));
  });

  it("has no admin area", () => {
    expect(go(APP, "/admin")).toEqual(notFound);
    expect(go(APP, "/admin/businesses/123")).toEqual(notFound);
  });
});

describe("admin address", () => {
  it("serves the admin area and its own login only", () => {
    expect(go(ADMIN, "/admin")).toEqual(cont);
    expect(go(ADMIN, "/admin/users")).toEqual(cont);
    expect(go(ADMIN, "/login")).toEqual(cont);
    expect(go(ADMIN, "/api/auth/google/callback", "?code=1")).toEqual(cont);
  });

  it("opens the admin area from its front page and after login", () => {
    expect(go(ADMIN, "/")).toEqual(redirect("https://admin.teamflow.cyou/admin"));
    expect(go(ADMIN, "/dashboard")).toEqual(redirect("https://admin.teamflow.cyou/admin"));
  });

  it("offers no signup, onboarding or public pages", () => {
    expect(go(ADMIN, "/signup")).toEqual(redirect("https://app.teamflow.cyou/signup"));
    expect(go(ADMIN, "/onboarding")).toEqual(redirect("https://app.teamflow.cyou/onboarding"));
    expect(go(ADMIN, "/beauty-lounge")).toEqual(notFound);
  });
});

describe("an address we do not recognise", () => {
  it("sends visitors to the real address and hides the admin area", () => {
    const host = "bookbeauty.onrender.com";
    expect(go(host, "/")).toEqual(redirect("https://teamflow.cyou/"));
    expect(go(host, "/@hana")).toEqual(redirect("https://teamflow.cyou/@hana"));
    expect(go(host, "/login")).toEqual(redirect("https://app.teamflow.cyou/login"));
    expect(go(host, "/admin")).toEqual(notFound);
  });
});

describe("admin sharing the app address", () => {
  it("serves the admin area there when ADMIN_URL is not set", () => {
    const config: HostConfig = { ...split, admin: split.app };
    expect(decideRoute(APP, "/admin", "", config)).toEqual(cont);
    expect(decideRoute(SITE, "/admin", "", config)).toEqual(notFound);
  });
});
