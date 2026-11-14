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
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-800" role="status">
          {t("forgotSent")}
        </p>
      ) : (
        <form action={action} className="space-y-3">
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
          <BotCheck siteKey={botCheckSiteKey} resetSignal={state} />
          {state.error ? (
            <p className="text-sm text-red-700" role="alert">
              {t(`errors.${state.error}` as "errors.rate_limited")}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? t("working") : t("forgotSubmit")}
          </button>
        </form>
      )}

      <p className="text-xs text-neutral-500">{t("forgotNoEmail")}</p>
      <p className="text-center text-sm">
        <Link href="/login" className="underline">
          {t("backToLogin")}
        </Link>
      </p>
    </div>
  );
}
