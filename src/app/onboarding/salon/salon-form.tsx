"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  createSalonAction,
  type OnboardingFormState,
} from "@/modules/businesses/onboarding-actions";

const initial: OnboardingFormState = {};

const CATEGORIES = [
  "hair",
  "barber",
  "nails",
  "makeup",
  "lashes",
  "spa",
  "other",
] as const;

export function SalonForm() {
  const t = useTranslations("onboarding");
  const [state, action, pending] = useActionState(createSalonAction, initial);

  return (
    <form action={action} className="space-y-3">
      <label className="field">
        <span>{t("salonName")}</span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          className="field-input"
        />
      </label>
      <label className="field">
        <span>{t("slug")}</span>
        <input
          name="slug"
          required
          minLength={2}
          maxLength={40}
          placeholder={t("slugPlaceholder")}
          className="field-input"
        />
        <span className="text-xs text-muted">{t("slugHint")}</span>
      </label>
      <label className="field">
        <span>{t("category")}</span>
        <select
          name="category"
          required
          defaultValue="hair"
          className="field-input"
        >
          {CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {t(`categories.${key}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>{t("locationName")}</span>
        <input
          name="locationName"
          defaultValue="Main"
          className="field-input"
        />
      </label>
      <label className="field">
        <span>{t("phone")}</span>
        <input
          name="phone"
          type="tel"
          className="field-input"
        />
      </label>
      <label className="field">
        <span>{t("address")}</span>
        <input
          name="addressText"
          className="field-input"
        />
      </label>
      <label className="field">
        <span>{t("about")}</span>
        <textarea
          name="about"
          rows={3}
          maxLength={4000}
          className="field-input"
        />
      </label>
      {state.error ? (
        <p className="text-sm text-danger" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="btn btn-primary w-full"
      >
        {pending ? t("working") : t("salonSubmit")}
      </button>
      <p className="text-center text-sm text-muted">
        <Link href="/onboarding" className="link">
          {t("back")}
        </Link>
      </p>
    </form>
  );
}
