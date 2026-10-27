import { NextResponse } from "next/server";
import { env } from "@/env";
import { finishGoogleLogin } from "@/modules/identity/google";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const oauthError = url.searchParams.get("error");

  if (oauthError || !code || !state) {
    return NextResponse.redirect(new URL("/login?error=oauth_failed", env.APP_URL));
  }

  const result = await finishGoogleLogin(code, state, {
    ipAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: request.headers.get("user-agent"),
  });

  if (!result.ok) {
    return NextResponse.redirect(new URL(`/login?error=${result.error}`, env.APP_URL));
  }

  return NextResponse.redirect(new URL("/onboarding", env.APP_URL));
}
