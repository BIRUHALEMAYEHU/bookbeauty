"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  updateBusinessPageAction,
  type PageSettingsState,
} from "@/modules/businesses/page-actions";

type Values = {
  kind: "independent" | "salon";
  name: string;
  about: string;
  phone: string;
  locationName: string;
  addressText: string;
  addressPublic: boolean;
};

const initial: PageSettingsState = {};
const input = "field-input";

export function PageSettingsForm({ businessId, values }: { businessId: string; values: Values }) {
  const t = useTranslations("pageSettings");
  const [state, action, pending] = useActionState(
    updateBusinessPageAction.bind(null, businessId),
    initial,
  );
  const salon = values.kind === "salon";

  return (
    <form action={action} className="space-y-4">
      <label className="field">
        <span>{salon ? t("salonName") : t("displayName")}</span>
        <input name="name" required minLength={2} maxLength={120} defaultValue={values.name} className={input} />
      </label>

      <label className="field">
        <span>{salon ? t("about") : t("bio")}</span>
        <textarea name="about" rows={4} maxLength={salon ? 4000 : 2000} defaultValue={values.about} className={input} />
      </label>

      <label className="field">
        <span>{t("phone")}</span>
        <input name="phone" type="tel" autoComplete="tel" defaultValue={values.phone} className={input} />
        <span className="text-xs text-muted">{t("phoneHint")}</span>
      </label>

      {salon ? (
        <label className="field">
          <span>{t("locationName")}</span>
          <input name="locationName" maxLength={80} defaultValue={values.locationName} className={input} />
        </label>
      ) : null}

      <label className="field">
        <span>{t("address")}</span>
        <input name="addressText" maxLength={500} defaultValue={values.addressText} className={input} />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input name="addressPublic" type="checkbox" defaultChecked={values.addressPublic} className="mt-1" />
        <span>
          <span className="block">{t("addressPublic")}</span>
          {salon ? null : <span className="block text-xs text-muted">{t("addressPublicHint")}</span>}
        </span>
      </label>

      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {t(`errors.${state.error}` as "errors.invalid_input")}
        </p>
      ) : null}
      {state.saved && !pending ? (
        <p className="text-sm text-primary-dark" role="status">
          {t("saved")}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
