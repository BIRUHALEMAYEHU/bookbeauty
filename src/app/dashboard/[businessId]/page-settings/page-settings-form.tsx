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
const input = "w-full rounded-md border border-neutral-300 px-3 py-2";

export function PageSettingsForm({ businessId, values }: { businessId: string; values: Values }) {
  const t = useTranslations("pageSettings");
  const [state, action, pending] = useActionState(
    updateBusinessPageAction.bind(null, businessId),
    initial,
  );
  const salon = values.kind === "salon";

  return (
    <form action={action} className="space-y-4">
      <label className="block space-y-1 text-sm">
        <span>{salon ? t("salonName") : t("displayName")}</span>
        <input name="name" required minLength={2} maxLength={120} defaultValue={values.name} className={input} />
      </label>

      <label className="block space-y-1 text-sm">
        <span>{salon ? t("about") : t("bio")}</span>
        <textarea name="about" rows={4} maxLength={salon ? 4000 : 2000} defaultValue={values.about} className={input} />
      </label>

      <label className="block space-y-1 text-sm">
        <span>{t("phone")}</span>
        <input name="phone" type="tel" autoComplete="tel" defaultValue={values.phone} className={input} />
        <span className="text-xs text-neutral-500">{t("phoneHint")}</span>
      </label>

      {salon ? (
        <label className="block space-y-1 text-sm">
          <span>{t("locationName")}</span>
          <input name="locationName" maxLength={80} defaultValue={values.locationName} className={input} />
        </label>
      ) : null}

      <label className="block space-y-1 text-sm">
        <span>{t("address")}</span>
        <input name="addressText" maxLength={500} defaultValue={values.addressText} className={input} />
      </label>

      <label className="flex items-start gap-2 text-sm">
        <input name="addressPublic" type="checkbox" defaultChecked={values.addressPublic} className="mt-1" />
        <span>
          <span className="block">{t("addressPublic")}</span>
          {salon ? null : <span className="block text-xs text-neutral-500">{t("addressPublicHint")}</span>}
        </span>
      </label>

      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {t(`errors.${state.error}` as "errors.invalid_input")}
        </p>
      ) : null}
      {state.saved && !pending ? (
        <p className="text-sm text-green-800" role="status">
          {t("saved")}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
      >
        {pending ? t("saving") : t("save")}
      </button>
    </form>
  );
}
