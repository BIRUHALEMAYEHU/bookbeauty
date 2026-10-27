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
      <label className="block space-y-1 text-sm">
        <span>{t("salonName")}</span>
        <input
          name="name"
          required
          minLength={2}
          maxLength={120}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("slug")}</span>
        <input
          name="slug"
          required
          minLength={2}
          maxLength={40}
          placeholder={t("slugPlaceholder")}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
        <span className="text-xs text-neutral-500">{t("slugHint")}</span>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("category")}</span>
        <select
          name="category"
          required
          defaultValue="hair"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        >
          {CATEGORIES.map((key) => (
            <option key={key} value={key}>
              {t(`categories.${key}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("locationName")}</span>
        <input
          name="locationName"
          defaultValue="Main"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("phone")}</span>
        <input
          name="phone"
          type="tel"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("address")}</span>
        <input
          name="addressText"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("about")}</span>
        <textarea
          name="about"
          rows={3}
          maxLength={4000}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      {state.error ? (
        <p className="text-sm text-red-700" role="alert">
          {t(`errors.${state.error}`)}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-neutral-900 px-3 py-2 text-sm text-white disabled:opacity-60"
      >
        {pending ? t("working") : t("salonSubmit")}
      </button>
      <p className="text-center text-sm text-neutral-600">
        <Link href="/onboarding" className="underline">
          {t("back")}
        </Link>
      </p>
    </form>
  );
}
