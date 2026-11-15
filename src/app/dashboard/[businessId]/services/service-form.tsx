"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { saveServiceAction, type ServiceFormState } from "@/modules/catalog/actions";

type LocationType = "studio" | "client_place" | "both";

export type ServiceFormValues = {
  name: string;
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  locationType: LocationType;
  /** Prices as she types them, in birr ("800" or "1250.50"). */
  priceStudio: string;
  priceClientPlace: string;
  providerMembershipIds: string[];
};

type Choice = { value: number; label: string };

const initial: ServiceFormState = {};

export function ServiceForm({
  businessId,
  serviceId,
  solo,
  values,
  durations,
  buffers,
  providers,
}: {
  businessId: string;
  /** Null when adding a new service. */
  serviceId: string | null;
  /** A solo practice: she performs everything, so there is nobody to choose. */
  solo: boolean;
  values: ServiceFormValues;
  durations: Choice[];
  buffers: Choice[];
  providers: { membershipId: string; displayName: string }[];
}) {
  const t = useTranslations("services");
  const [state, action, pending] = useActionState(
    saveServiceAction.bind(null, businessId, serviceId),
    initial,
  );
  const [locationType, setLocationType] = useState<LocationType>(values.locationType);

  const places: { value: LocationType; label: string }[] = [
    { value: "studio", label: solo ? t("locationStudioSolo") : t("locationStudio") },
    { value: "client_place", label: t("locationClientPlace") },
    { value: "both", label: t("locationBoth") },
  ];

  return (
    <form action={action} className="space-y-5">
      <label className="field">
        <span>{t("name")}</span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={80}
          defaultValue={values.name}
          placeholder={t("namePlaceholder")}
          className="field-input"
        />
      </label>

      <div className="grid grid-cols-2 gap-3">
        <label className="field">
          <span>{t("duration")}</span>
          <select name="durationMinutes" defaultValue={values.durationMinutes} className="field-input">
            {durations.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>{t("buffer")}</span>
          <select name="bufferMinutes" defaultValue={values.bufferMinutes} className="field-input">
            {buffers.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="-mt-3 text-xs text-muted">{t("bufferHint")}</p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">{t("locationType")}</legend>
        <div className="flex flex-wrap gap-2">
          {places.map((place) => (
            <label key={place.value} className="choice">
              <input
                type="radio"
                name="locationType"
                value={place.value}
                checked={locationType === place.value}
                onChange={() => setLocationType(place.value)}
              />
              <span>{place.label}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {locationType !== "client_place" ? (
        <label className="field">
          <span>{solo ? t("priceStudioSolo") : t("priceStudio")}</span>
          <input
            name="priceStudio"
            required
            inputMode="decimal"
            maxLength={12}
            defaultValue={values.priceStudio}
            className="field-input"
          />
        </label>
      ) : null}

      {locationType !== "studio" ? (
        <label className="field">
          <span>{t("priceClientPlace")}</span>
          <input
            name="priceClientPlace"
            required
            inputMode="decimal"
            maxLength={12}
            defaultValue={values.priceClientPlace}
            className="field-input"
          />
          <span className="text-xs text-muted">{t("priceClientPlaceHint")}</span>
        </label>
      ) : null}

      {solo ? null : (
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{t("providers")}</legend>
          {providers.length === 0 ? (
            <p className="text-sm text-muted">{t("providersEmpty")}</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                {providers.map((provider) => (
                  <label key={provider.membershipId} className="choice">
                    <input
                      type="checkbox"
                      name="providers"
                      value={provider.membershipId}
                      defaultChecked={values.providerMembershipIds.includes(provider.membershipId)}
                    />
                    <span>{provider.displayName}</span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted">{t("providersHint")}</p>
            </>
          )}
        </fieldset>
      )}

      <label className="field">
        <span>{t("description")}</span>
        <textarea
          name="description"
          rows={3}
          maxLength={500}
          defaultValue={values.description}
          className="field-input"
        />
        <span className="text-xs text-muted">{t("descriptionHint")}</span>
      </label>

      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {t(`errors.${state.error}` as "errors.invalid_input")}
        </p>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? t("saving") : t("save")}
        </button>
        <Link href={`/dashboard/${businessId}/services`} className="btn btn-quiet">
          {t("cancel")}
        </Link>
      </div>
    </form>
  );
}
