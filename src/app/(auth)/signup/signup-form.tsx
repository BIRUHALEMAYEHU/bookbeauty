"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  googleLoginAction,
  signupAction,
  type FormState,
} from "@/modules/identity/actions";
import { BotCheck } from "../bot-check";
import { TelegramLoginButton } from "../telegram-login-button";

const initial: FormState = {};

export function SignupForm({
  googleEnabled,
  telegramBotUsername,
  botCheckSiteKey,
}: {
  googleEnabled: boolean;
  telegramBotUsername: string | null;
  botCheckSiteKey: string | null;
}) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(signupAction, initial);

  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <label className="field">
          <span>{t("displayName")}</span>
          <input
            name="displayName"
            required
            autoComplete="name"
            className="field-input"
          />
        </label>
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
            autoComplete="new-password"
            minLength={8}
            className="field-input"
          />
          <span className="text-xs text-muted">{t("passwordHint")}</span>
        </label>
        <BotCheck siteKey={botCheckSiteKey} resetSignal={state} />
        {state.error ? (
          <p className="text-sm text-danger" role="alert">
            {t(`errors.${state.error}` as "errors.email_taken")}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={pending}
          className="btn btn-primary w-full"
        >
          {pending ? t("working") : t("signupSubmit")}
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
        {t("hasAccount")}{" "}
        <Link href="/login" className="link">
          {t("loginLink")}
        </Link>
      </p>
    </div>
  );
}
