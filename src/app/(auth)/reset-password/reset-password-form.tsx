"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { resetPasswordAction, type FormState } from "@/modules/identity/actions";

const initial: FormState = {};

export function ResetPasswordForm({ token }: { token: string }) {
  const t = useTranslations("auth");
  const [state, action, pending] = useActionState(resetPasswordAction, initial);

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="token" value={token} />
      <label className="field">
        <span>{t("newPassword")}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="field-input"
        />
        <span className="text-xs text-muted">{t("passwordHint")}</span>
      </label>
      {state.error ? (
        <div className="space-y-1 text-sm text-danger" role="alert">
          <p>{t(`errors.${state.error}` as "errors.link_invalid")}</p>
          {state.error === "link_invalid" ? (
            <Link href="/forgot-password" className="link">
              {t("requestNewLink")}
            </Link>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full"
      >
        {pending ? t("working") : t("resetSubmit")}
      </button>
    </form>
  );
}
