import "server-only";
import { env } from "@/env";

/**
 * Cloudflare Turnstile verification (F07). When secrets are unset (local
 * development), tokens are accepted so signup stays usable without Cloudflare.
 */
export async function verifyTurnstileToken(
  token: string | null | undefined,
  ipAddress?: string | null,
): Promise<boolean> {
  const secret = env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Bot protection disabled until credentials are configured.
    return true;
  }

  if (!token) return false;

  const body = new URLSearchParams({
    secret,
    response: token,
  });
  if (ipAddress) body.set("remoteip", ipAddress);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body },
  );

  if (!response.ok) return false;
  const data = (await response.json()) as { success?: boolean };
  return data.success === true;
}

export function turnstileSiteKey(): string | null {
  return env.TURNSTILE_SITE_KEY ?? null;
}
