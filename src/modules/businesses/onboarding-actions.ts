"use server";

import { redirect } from "next/navigation";
import { createIndependentPractice, createSalon } from "./create";
import { getSessionUser } from "@/modules/identity/session";

export type OnboardingFormState = {
  error?: string;
};

export async function createIndependentAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await createIndependentPractice(user.id, {
    handle: String(formData.get("handle") ?? ""),
    displayName: String(formData.get("displayName") ?? ""),
    bio: String(formData.get("bio") ?? "") || undefined,
    category: String(formData.get("category") ?? "") as
      | "hair"
      | "barber"
      | "nails"
      | "makeup"
      | "lashes"
      | "spa"
      | "other",
    phone: String(formData.get("phone") ?? "") || undefined,
    addressText: String(formData.get("addressText") ?? "") || undefined,
  });

  if (!result.ok) return { error: result.error };
  redirect("/account");
}

export async function createSalonAction(
  _prev: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const result = await createSalon(user.id, {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    category: String(formData.get("category") ?? "") as
      | "hair"
      | "barber"
      | "nails"
      | "makeup"
      | "lashes"
      | "spa"
      | "other",
    phone: String(formData.get("phone") ?? "") || undefined,
    about: String(formData.get("about") ?? "") || undefined,
    locationName: String(formData.get("locationName") ?? "") || undefined,
    addressText: String(formData.get("addressText") ?? "") || undefined,
  });

  if (!result.ok) return { error: result.error };
  redirect("/account");
}
