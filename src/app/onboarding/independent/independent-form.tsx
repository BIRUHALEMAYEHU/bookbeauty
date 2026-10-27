"use client";

import Link from "next/link";
import { useActionState } from "react";
import { useTranslations } from "next-intl";
import {
  createIndependentAction,
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

export function IndependentForm({ defaultName }: { defaultName: string }) {
  const t = useTranslations("onboarding");
  const [state, action, pending] = useActionState(createIndependentAction, initial);

  return (
    <form action={action} className="space-y-3">
      <label className="block space-y-1 text-sm">
        <span>{t("handle")}</span>
        <input
          name="handle"
          required
          minLength={2}
          maxLength={40}
          placeholder={t("handlePlaceholder")}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
        <span className="text-xs text-neutral-500">{t("handleHint")}</span>
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("displayName")}</span>
        <input
          name="displayName"
          required
          defaultValue={defaultName}
          minLength={2}
          maxLength={80}
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
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
        <span>{t("phone")}</span>
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
      </label>
      <label className="block space-y-1 text-sm">
        <span>{t("bio")}</span>
        <textarea
          name="bio"
          rows={3}
          maxLength={2000}
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
        {pending ? t("working") : t("independentSubmit")}
      </button>
      <p className="text-center text-sm text-neutral-600">
        <Link href="/onboarding" className="underline">
          {t("back")}
        </Link>
      </p>
    </form>
  );
}
