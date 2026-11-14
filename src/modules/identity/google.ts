import "server-only";
import { Google, generateCodeVerifier, generateState } from "arctic";
import { cookies } from "next/headers";
import { env, googleEnabled } from "@/env";
import { resolveGoogleAccount, type GoogleProfile } from "./accounts";
import { createOAuthState, verifyOAuthState } from "./oauth-state";
import { createSession } from "./session";

const CODE_VERIFIER_COOKIE = "book_google_cv";
const STATE_COOKIE = "book_google_state";

function googleClient() {
  if (!googleEnabled()) {
    throw new Error("Google login is not configured");
  }
  return new Google(
    env.GOOGLE_CLIENT_ID!,
    env.GOOGLE_CLIENT_SECRET!,
    `${env.APP_URL}/api/auth/google/callback`,
  );
}

export async function startGoogleLogin() {
  const google = googleClient();
  const state = createOAuthState(generateState());
  const codeVerifier = generateCodeVerifier();
  const url = google.createAuthorizationURL(state, codeVerifier, [
    "openid",
    "profile",
    "email",
  ]);

  const cookieStore = await cookies();
  const cookieOpts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 10 * 60,
  };
  cookieStore.set(STATE_COOKIE, state, cookieOpts);
  cookieStore.set(CODE_VERIFIER_COOKIE, codeVerifier, cookieOpts);

  return url.toString();
}

export async function finishGoogleLogin(
  code: string,
  state: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ ok: true } | { ok: false; error: "invalid_state" | "oauth_failed" }> {
  const cookieStore = await cookies();
  const storedState = cookieStore.get(STATE_COOKIE)?.value;
  const codeVerifier = cookieStore.get(CODE_VERIFIER_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);
  cookieStore.delete(CODE_VERIFIER_COOKIE);

  if (!storedState || !codeVerifier || storedState !== state || !verifyOAuthState(state)) {
    return { ok: false, error: "invalid_state" };
  }

  try {
    const google = googleClient();
    const tokens = await google.validateAuthorizationCode(code, codeVerifier);
    const accessToken = tokens.accessToken();

    const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return { ok: false, error: "oauth_failed" };

    const profile = (await response.json()) as GoogleProfile;

    if (!profile.sub) return { ok: false, error: "oauth_failed" };

    const account = await resolveGoogleAccount(profile);
    if (!account.ok) return { ok: false, error: "oauth_failed" };

    await createSession(account.userId, meta);
    return { ok: true };
  } catch {
    return { ok: false, error: "oauth_failed" };
  }
}
