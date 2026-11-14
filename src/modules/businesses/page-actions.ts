"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { forBusiness } from "@/db/scope";
import { cacheTags } from "@/lib/cache-tags";
import { getSessionUser } from "@/modules/identity/session";
import { updateBusinessPage } from "./page-settings";

export type PageSettingsState = { error?: string; saved?: boolean };

export async function updateBusinessPageAction(
  businessId: string,
  _prev: PageSettingsState,
  formData: FormData,
): Promise<PageSettingsState> {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const scope = await forBusiness(businessId, user.id);
  if (!scope) return { error: "forbidden" };

  const text = (name: string) => String(formData.get(name) ?? "");
  const result = await updateBusinessPage(scope, {
    name: text("name"),
    about: text("about") || undefined,
    phone: text("phone") || undefined,
    locationName: text("locationName") || undefined,
    addressText: text("addressText") || undefined,
    addressPublic: formData.get("addressPublic") === "on",
  });
  if (!result.ok) return { error: result.error };

  // Show the change on the public pages straight away.
  updateTag(cacheTags.business(businessId));
  updateTag(cacheTags.profile(user.id));
  return { saved: true };
}
