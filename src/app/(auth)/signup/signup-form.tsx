"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  googleLoginAction,
  signupAction,
  type FormState,
} from "@/modules/identity/actions";
import { TelegramLoginButton } from "../telegram-login-button";

const initial: FormState = {};

export function SignupForm({
  googleEnabled,
  telegramBotUsername,
}: {
  googleEnabled: boolean;
  telegramBotUsername: string | null;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(signupAction, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label className="block space-y-1 text-sm">
          <span>{t("displayName")}</span>
          <input
            name="displayName"
            required
            autoComplete="name"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("email")}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
        </label>
        <label className="block space-y-1 text-sm">
          <span>{t("password")}</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="new-password"
            minLength={8}
            className="w-full rounded-md border border-neutral-300 px-3 py-2"
          />
          <span className="text-xs text-neutral-500">{t("passwordHint")}</span>
        </label>
        {state.error ? (
          <p className="text-sm text-red-700" role="alert">
            {t(`errors.${state.error}` as "errors.email_taken")}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          {pending ? t("working") : t("signupSubmit")}
        </button>
      </form>

      {(googleEnabled || telegramBotUsername) && (
        <div className="space-y-3 border-t border-neutral-200 pt-4">
          <p className="text-center text-xs text-neutral-500">{t("orContinue")}</p>
          {googleEnabled ? (
            <form action={googleLoginAction}>
              <button
                type="submit"
                className="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              >
                {t("continueGoogle")}
              </button>
            </form>
          ) : null}
          {telegramBotUsername ? (
            <TelegramLoginButton botUsername={telegramBotUsername} />
          ) : null}
        </div>
      )}

      <p className="text-center text-sm text-neutral-600">
        {t("hasAccount")}{" "}
        <Link href="/login" className="underline">
          {t("loginLink")}
        </Link>
      </p>
    </div>
  );
}
