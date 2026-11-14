import { NextResponse } from "next/server";
import { env } from "@/env";
import { verifyEmail } from "@/modules/identity/email-verification";
import { getSessionUser } from "@/modules/identity/session";

/** The link in the "confirm your email" message lands here. */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const result = await verifyEmail(token);
  const signedIn = Boolean(await getSessionUser());

  const target = result.ok
    ? signedIn
      ? "/account?notice=email_verified"
      : "/login?notice=email_verified"
    : signedIn
      ? "/account?notice=link_invalid"
      : "/login?error=link_invalid";

  return NextResponse.redirect(new URL(target, env.APP_URL));
}
