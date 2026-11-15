"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  googleLoginAction,
  loginAction,
  type FormState,
} from "@/modules/identity/actions";
import { TelegramLoginButton } from "../telegram-login-button";

const initial: FormState = {};

export function LoginForm({
  googleEnabled,
  telegramBotUsername,
}: {
  googleEnabled: boolean;
  telegramBotUsername: string | null;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(loginAction, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label className="field">
          <span>{t("email")}</span>
          <input
            name="email"
            type="email"
            required
            autoComplete="email"
            className="field-input"
          />
        </label>
        <label className="field">
          <span>{t("password")}</span>
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field-input"
          />
        </label>
        <p className="text-right text-sm">
          <Link href="/forgot-password" className="link">
            {t("forgotLink")}
          </Link>
        </p>
        {state.error ? (
          <p className="text-sm text-danger" role="alert">
            {t(`errors.${state.error}` as "errors.invalid_credentials")}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary w-full"
        >
          {pending ? t("working") : t("loginSubmit")}
        </button>
      </form>

      {(googleEnabled || telegramBotUsername) && (
        <div className="space-y-3 border-t border-line pt-4">
          <p className="text-center text-xs text-muted">{t("orContinue")}</p>
          {googleEnabled ? (
            <form action={googleLoginAction}>
              <button
                type="submit"
                className="btn btn-quiet w-full"
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

      <p className="text-center text-sm text-muted">
        {t("noAccount")}{" "}
        <Link href="/signup" className="link">
          {t("signupLink")}
        </Link>
      </p>
    </div>
  );
}
