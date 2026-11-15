"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { BotCheck } from "@/app/(auth)/bot-check";
import { submitDetailsAction, type DetailsFormState } from "@/modules/booking/guest-actions";

const initial: DetailsFormState = {};

export function DetailsForm({
  token,
  atClientPlace,
  botCheckSiteKey,
}: {
  token: string;
  atClientPlace: boolean;
  botCheckSiteKey: string | null;
}) {
  const t = useTranslations("booking");
  const [state, action, pending] = useActionState(submitDetailsAction.bind(null, token), initial);
  // The browser clears a form after each try; this puts back what she typed.
  const kept = state.values ?? {};

  return (
    <form action={action} className="space-y-4">
      <label className="field">
        <span>{t("name")}</span>
        <input name="name" defaultValue={kept.name} required minLength={2} maxLength={100} autoComplete="name" className="field-input" />
      </label>
      <label className="field">
        <span>{t("phone")}</span>
        <input
          name="phone"
          defaultValue={kept.phone}
          type="tel"
          required
          maxLength={40}
          autoComplete="tel"
          inputMode="tel"
          className="field-input"
        />
        <span className="text-xs text-muted">{t("phoneHint")}</span>
      </label>
      {atClientPlace ? (
        <label className="field">
          <span>{t("address")}</span>
          <textarea name="addressText" defaultValue={kept.addressText} required rows={2} maxLength={500} className="field-input" />
          <span className="text-xs text-muted">{t("addressHint")}</span>
        </label>
      ) : null}
      <label className="field">
        <span>{t("email")}</span>
        <input name="email" defaultValue={kept.email} type="email" maxLength={200} autoComplete="email" className="field-input" />
      </label>
      <label className="field">
        <span>{t("allergies")}</span>
        <input name="allergies" defaultValue={kept.allergies} maxLength={500} className="field-input" />
        <span className="text-xs text-muted">{t("allergiesHint")}</span>
      </label>
      <label className="field">
        <span>{t("notes")}</span>
        <textarea name="notes" defaultValue={kept.notes} rows={2} maxLength={1000} className="field-input" />
      </label>

      <BotCheck siteKey={botCheckSiteKey} resetSignal={state} />
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {t(`errors.${state.error}` as "errors.invalid_input")}
        </p>
      ) : null}
      <button type="submit" disabled={pending} className="btn btn-primary w-full">
        {pending ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}
