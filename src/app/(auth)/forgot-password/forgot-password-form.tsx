"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { forgotPasswordAction, type FormState } from "@/modules/identity/actions";
import { BotCheck } from "../bot-check";

const initial: FormState = {};

export function ForgotPasswordForm({ botCheckSiteKey }: { botCheckSiteKey: string | null }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(forgotPasswordAction, initial);

  return (
    <div className="space-y-4">
      {state.sent ? (
        <p className="rounded-md bg-primary-tint px-3 py-2 text-sm text-primary-dark" role="status">
          {t("forgotSent")}
        </p>
      ) : (
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
          <BotCheck siteKey={botCheckSiteKey} resetSignal={state} />
          {state.error ? (
            <p className="text-sm text-danger" role="alert">
              {t(`errors.${state.error}` as "errors.rate_limited")}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="btn btn-primary w-full"
          >
            {pending ? t("working") : t("forgotSubmit")}
          </button>
        </form>
      )}

      <p className="text-xs text-muted">{t("forgotNoEmail")}</p>
      <p className="text-center text-sm">
        <Link href="/login" className="link">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
