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
      <label className="block space-y-1 text-sm">
        <span>{t("newPassword")}</span>
        <input
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
        <span className="text-xs text-neutral-500">{t("passwordHint")}</span>
      </label>
      {state.error ? (
        <div className="space-y-1 text-sm text-red-700" role="alert">
          <p>{t(`errors.${state.error}` as "errors.link_invalid")}</p>
          {state.error === "link_invalid" ? (
            <Link href="/forgot-password" className="underline">
              {t("requestNewLink")}
            </Link>
          ) : null}
        </div>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("working") : t("resetSubmit")}
      </button>
    </form>
  );
}
