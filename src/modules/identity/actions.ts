"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { loginWithEmail, signupWithEmail } from "./email-auth";
import { startGoogleLogin } from "./google";
import { destroySession } from "./session";
import { loginWithTelegram } from "./telegram-auth";
import type { TelegramAuthPayload } from "./telegram";

async function requestMeta() {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

export type FormState = {
  error?: string;
};

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await signupWithEmail(
    {
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    },
    await requestMeta(),
  );

  if (!result.ok) return { error: result.error };
  redirect("/onboarding");
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await loginWithEmail(
    {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    },
    await requestMeta(),
  );

  if (!result.ok) return { error: result.error };
  redirect("/onboarding");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}

export async function googleLoginAction() {
  const url = await startGoogleLogin();
  redirect(url);
}

export async function telegramLoginAction(payload: TelegramAuthPayload): Promise<FormState> {
  const result = await loginWithTelegram(payload, await requestMeta());
  if (!result.ok) return { error: result.error };
  redirect("/onboarding");
}
