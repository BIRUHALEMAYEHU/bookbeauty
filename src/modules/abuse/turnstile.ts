import "server-only";
import { env } from "@/env";

/** The form field Cloudflare's widget fills in. */
export const TURNSTILE_FIELD = "cf-turnstile-response";

/**
 * Cloudflare Turnstile verification (F07). With no secret configured (local
 * development) every request passes, so forms stay usable without Cloudflare.
 * If Cloudflare cannot be reached the check fails, rather than letting bots in.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  ipAddress?: string | null,
  secret: string | undefined = env.TURNSTILE_SECRET_KEY,
): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;

  const body = new URLSearchParams({ secret, response: token });
  if (ipAddress) body.set("remoteip", ipAddress);

  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body },
    );
    if (!response.ok) return false;
    const data = (await response.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * Site key for the browser widget, or null when bot protection is off. Pages
 * that show the widget read it at build time, so set it before building.
 */
export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY || null;
}
