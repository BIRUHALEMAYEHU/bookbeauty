/**
 * Which address serves what (D108, D109).
 *
 * - site:  the main domain. Home page and public booking pages (/slug, /@handle).
 * - app:   login, onboarding, dashboard, account.
 * - admin: the platform administrator's area, with its own login.
 *
 * Each is one setting (SITE_URL, APP_URL, ADMIN_URL). When they are all the
 * same address, as on a developer's machine, everything is served together
 * and none of the rules below apply. Moving to a new domain means changing
 * the three settings.
 *
 * This file has no imports on purpose: the proxy, server code and tests all use it.
 */

export type Area = "site" | "app" | "admin";

export type HostConfig = {
  site: string;
  app: string;
  admin: string;
};

type Env = Record<string, string | undefined>;

function origin(value: string | undefined, fallback: string): string {
  try {
    return new URL(value || fallback).origin;
  } catch {
    return new URL(fallback).origin;
  }
}

/** Reads the three addresses. SITE_URL and ADMIN_URL default to APP_URL. */
export function readHostConfig(env: Env = process.env): HostConfig {
  const app = origin(env.APP_URL, "http://localhost:3000");
  return { app, site: origin(env.SITE_URL, app), admin: origin(env.ADMIN_URL, app) };
}

/** The areas a request's Host header is allowed to serve. Empty for an unknown host. */
export function areasForHost(host: string | null | undefined, config: HostConfig): Area[] {
  const name = (host ?? "").trim().toLowerCase();
  return (["site", "app", "admin"] as const).filter(
    (area) => new URL(config[area]).host.toLowerCase() === name,
  );
}

/** True when the admin area has an address of its own. */
export function adminIsSeparate(config: HostConfig): boolean {
  return config.admin !== config.app;
}

const APP_PATHS = [
  "/login",
  "/signup",
  "/forgot-password",
  "/reset-password",
  "/onboarding",
  "/dashboard",
  "/account",
  "/api/auth",
  // Telegram does not follow redirects, so its webhook must answer on the app address it was given.
  "/api/telegram",
];

/** The only app pages the admin address also serves: its own login. */
const ADMIN_LOGIN_PATHS = ["/login", "/api/auth/google"];

function under(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** Which area a path belongs to. Anything not listed is a public page. */
export function areaForPath(pathname: string): Area {
  if (under(pathname, ["/admin"])) return "admin";
  if (under(pathname, APP_PATHS)) return "app";
  return "site";
}

export type RouteDecision =
  | { action: "continue" }
  | { action: "redirect"; to: string }
  | { action: "notFound" };

const CONTINUE: RouteDecision = { action: "continue" };
const NOT_FOUND: RouteDecision = { action: "notFound" };

/**
 * What to do with a request for `pathname` (plus `search`) arriving at `host`.
 * The admin area answers only on its own address; everywhere else it does not exist.
 */
export function decideRoute(
  host: string | null | undefined,
  pathname: string,
  search: string,
  config: HostConfig,
): RouteDecision {
  if (config.site === config.app && config.app === config.admin) return CONTINUE;

  const here = areasForHost(host, config);
  const wanted = areaForPath(pathname);
  const to = (area: Area, path = pathname) => ({
    action: "redirect" as const,
    to: `${config[area]}${path}${path === pathname ? search : ""}`,
  });

  // An address we do not recognise (for example the host's default domain):
  // send public and app pages to their real address; the admin area stays hidden.
  if (here.length === 0) return wanted === "admin" ? NOT_FOUND : to(wanted);

  if (here.includes(wanted)) return CONTINUE;

  if (wanted === "admin") return NOT_FOUND;

  const adminOnly = here.includes("admin") && !here.includes("app");
  if (adminOnly) {
    if (pathname === "/") return to("admin", "/admin");
    if (under(pathname, ADMIN_LOGIN_PATHS)) return CONTINUE;
    // After logging in, "the dashboard" on the admin address is the admin area.
    if (under(pathname, ["/dashboard"])) return to("admin", "/admin");
    if (wanted === "app") return to("app");
    return NOT_FOUND;
  }

  // The front page of the app address, which has no public pages, opens the dashboard.
  if (pathname === "/") return to("app", "/dashboard");
  return to(wanted);
}
