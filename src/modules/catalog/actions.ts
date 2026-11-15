"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { forBusiness } from "@/db/scope";
import { cacheTags } from "@/lib/cache-tags";
import { getSessionUser } from "@/modules/identity/session";
import {
  createService,
  moveService,
  parsePrice,
  setServiceArchived,
  updateService,
  type ServiceInput,
} from "./services";

/** On an error the form gets back what was typed, so one mistake does not wipe the rest. */
export type ServiceFormState = {
  error?: string;
  values?: {
    name: string;
    description: string;
    durationMinutes: number;
    bufferMinutes: number;
    priceStudio: string;
    priceClientPlace: string;
    providerMembershipIds: string[];
  };
};

async function scopeFor(businessId: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return forBusiness(businessId, user.id);
}

/** The public pages list services, so every change refreshes them at once. */
function refreshPublicPages(businessId: string) {
  updateTag(cacheTags.business(businessId));
}

/** An empty price box means "no price given"; anything else must be a real price. */
function readPrice(formData: FormData, name: string): number | null | "invalid" {
  const text = String(formData.get(name) ?? "").trim();
  if (!text) return null;
  return parsePrice(text) ?? "invalid";
}

/** Creates a service, or saves changes to one when serviceId is given. */
export async function saveServiceAction(
  businessId: string,
  serviceId: string | null,
  _prev: ServiceFormState,
  formData: FormData,
): Promise<ServiceFormState> {
  const values = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? ""),
    durationMinutes: Number(formData.get("durationMinutes")),
    bufferMinutes: Number(formData.get("bufferMinutes")),
    priceStudio: String(formData.get("priceStudio") ?? ""),
    priceClientPlace: String(formData.get("priceClientPlace") ?? ""),
    providerMembershipIds: formData.getAll("providers").map(String),
  };
  const scope = await scopeFor(businessId);
  if (!scope) return { error: "forbidden", values };

  const priceStudio = readPrice(formData, "priceStudio");
  const priceClientPlace = readPrice(formData, "priceClientPlace");
  if (priceStudio === "invalid" || priceClientPlace === "invalid") {
    return { error: "price_invalid", values };
  }

  const input: ServiceInput = {
    name: String(formData.get("name") ?? ""),
    description: String(formData.get("description") ?? "") || undefined,
    durationMinutes: Number(formData.get("durationMinutes")),
    bufferMinutes: Number(formData.get("bufferMinutes")),
    locationType: String(formData.get("locationType")) as ServiceInput["locationType"],
    priceStudio,
    priceClientPlace,
    providerMembershipIds: formData.getAll("providers").map(String),
  };

  const result = serviceId
    ? await updateService(scope, serviceId, input)
    : await createService(scope, input);
  if (!result.ok) return { error: result.error, values };

  refreshPublicPages(businessId);
  redirect(`/dashboard/${businessId}/services`);
}

export async function archiveServiceAction(businessId: string, serviceId: string) {
  const scope = await scopeFor(businessId);
  if (scope && (await setServiceArchived(scope, serviceId, true)).ok) {
    refreshPublicPages(businessId);
  }
  redirect(`/dashboard/${businessId}/services`);
}

export async function restoreServiceAction(businessId: string, serviceId: string) {
  const scope = await scopeFor(businessId);
  if (scope && (await setServiceArchived(scope, serviceId, false)).ok) {
    refreshPublicPages(businessId);
  }
  redirect(`/dashboard/${businessId}/services`);
}

export async function moveServiceAction(
  businessId: string,
  serviceId: string,
  direction: "up" | "down",
) {
  const scope = await scopeFor(businessId);
  if (scope && (await moveService(scope, serviceId, direction)).ok) {
    refreshPublicPages(businessId);
  }
  redirect(`/dashboard/${businessId}/services`);
}
