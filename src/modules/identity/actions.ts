"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { TURNSTILE_FIELD, verifyTurnstileToken } from "@/modules/abuse/turnstile";
import { loginWithEmail, signupWithEmail } from "./email-auth";
import { sendVerificationEmail } from "./email-verification";
import { requestPasswordReset, resetPassword } from "./password-reset";
import { startGoogleLogin } from "./google";
import { createSession, destroySession, getSessionUser } from "./session";
import { loginWithTelegram } from "./telegram-auth";
import type { TelegramAuthPayload } from "./telegram";

async function requestMeta() {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: h.get("user-agent"),
  };
}

function passesBotCheck(formData: FormData, ipAddress: string | null) {
  const token = formData.get(TURNSTILE_FIELD);
  return verifyTurnstileToken(typeof token === "string" ? token : null, ipAddress);
}

export type FormState = {
  error?: string;
  sent?: boolean;
};

export async function signupAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const meta = await requestMeta();
  if (!(await passesBotCheck(formData, meta.ipAddress))) {
    return { error: "bot_check_failed" };
  }

  const result = await signupWithEmail(
    {
      displayName: String(formData.get("displayName") ?? ""),
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    },
    meta,
  );

  if (!result.ok) return { error: result.error };
  redirect("/dashboard");
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
  redirect("/dashboard");
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
  redirect("/dashboard");
}

export async function forgotPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const meta = await requestMeta();
  if (!(await passesBotCheck(formData, meta.ipAddress))) {
    return { error: "bot_check_failed" };
  }
  const result = await requestPasswordReset(String(formData.get("email") ?? ""), meta);
  if (!result.ok) return { error: result.error };
  return { sent: true };
}

export async function resetPasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const result = await resetPassword(
    String(formData.get("token") ?? ""),
    String(formData.get("password") ?? ""),
  );
  if (!result.ok) return { error: result.error };

  await createSession(result.userId, await requestMeta());
  redirect("/account?notice=password_reset");
}

export async function resendVerificationAction() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await sendVerificationEmail(user.id);
  if (result.ok) redirect("/account?notice=verification_sent");
  if (result.error === "rate_limited") {
    redirect("/account?notice=verification_rate_limited");
  }
  redirect("/account");
}
