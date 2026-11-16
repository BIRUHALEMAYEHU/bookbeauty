"use server";

import { redirect } from "next/navigation";
import { forBusiness } from "@/db/scope";
import { getSessionUser } from "@/modules/identity/session";
import { approveBooking, cancelBookingByBusiness, setApprovalMode } from "./manage";

async function scopeFor(businessId: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return forBusiness(businessId, user.id);
}

/** Back to the list, saying what happened when it did not work. */
function backToBookings(businessId: string, result: { ok: boolean; error?: string } | null) {
  const path = `/dashboard/${businessId}/bookings`;
  redirect(result && !result.ok ? `${path}?notice=${result.error}` : path);
}

export async function approveBookingAction(businessId: string, bookingId: string) {
  const scope = await scopeFor(businessId);
  backToBookings(businessId, scope ? await approveBooking(scope, bookingId) : null);
}

/** Declines a request or cancels a confirmed visit. */
export async function cancelBookingByBusinessAction(businessId: string, bookingId: string) {
  const scope = await scopeFor(businessId);
  backToBookings(businessId, scope ? await cancelBookingByBusiness(scope, bookingId) : null);
}

export async function setApprovalModeAction(businessId: string, formData: FormData) {
  const scope = await scopeFor(businessId);
  backToBookings(
    businessId,
    scope ? await setApprovalMode(scope, formData.get("mode") === "manual" ? "manual" : "auto") : null,
  );
}
