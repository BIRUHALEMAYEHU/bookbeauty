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

export function IndependentForm({
  defaultName,
  existingHandle,
}: {
  defaultName: string;
  /** She already has a professional profile; her handle is kept, not chosen again. */
  existingHandle: string | null;
}) {
  const t = useTranslations("onboarding");
  const [state, action, pending] = useActionState(createIndependentAction, initial);

  return (
    <form action={action} className="space-y-3">
      {existingHandle ? (
        <>
          <input type="hidden" name="handle" value={existingHandle} />
          <p className="rounded-md bg-wash px-3 py-2 text-sm text-muted">
            {t("handleKept", { handle: existingHandle })}
          </p>
        </>
      ) : (
        <label className="field">
          <span>{t("handle")}</span>
          <input
            name="handle"
            required
            minLength={2}
            maxLength={40}
            placeholder={t("handlePlaceholder")}
            className="field-input"
          />
          <span className="text-xs text-muted">{t("handleHint")}</span>
        </label>
      )}
      <label className="field">
        <span>{t("displayName")}</span>
        <input
          name="displayName"
          required
          defaultValue={defaultName}
          minLength={2}
          maxLength={80}
          className="field-input"
        />
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
        <span>{t("phone")}</span>
        <input
          name="phone"
          type="tel"
          autoComplete="tel"
          className="field-input"
        />
      </label>
      <label className="field">
        <span>{t("bio")}</span>
        <textarea
          name="bio"
          rows={3}
          maxLength={2000}
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
        {pending ? t("working") : t("independentSubmit")}
      </button>
      <p className="text-center text-sm text-muted">
        <Link href="/onboarding" className="link">
          {t("back")}
        </Link>
      </p>
    </form>
  );
}
