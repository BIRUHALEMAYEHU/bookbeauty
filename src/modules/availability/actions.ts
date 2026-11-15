"use server";

import { redirect } from "next/navigation";
import { forBusiness } from "@/db/scope";
import { getSessionUser } from "@/modules/identity/session";
import {
  addClosure,
  addException,
  MAX_SHIFTS_PER_DAY,
  removeClosure,
  removeException,
  setTravelBuffer,
  setWeeklyHours,
  updateBookingRules,
  type Shift,
} from "./hours";

export type HoursFormState = { error?: string; saved?: boolean };

async function scopeFor(businessId: string) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return forBusiness(businessId, user.id);
}

function optionalMinute(formData: FormData, name: string) {
  const text = String(formData.get(name) ?? "");
  return text === "" ? undefined : Number(text);
}

/**
 * Saves a week. The form sends, for each weekday `d` and shift `n`:
 * `d{d}_on` (working that day), `d{d}_s{n}` and `d{d}_e{n}` (start and end
 * minutes; an empty start means that shift is not used).
 */
export async function saveWeeklyHoursAction(
  businessId: string,
  membershipId: string,
  _prev: HoursFormState,
  formData: FormData,
): Promise<HoursFormState> {
  const scope = await scopeFor(businessId);
  if (!scope) return { error: "forbidden" };

  const shifts: Shift[] = [];
  for (let weekday = 0; weekday < 7; weekday++) {
    if (formData.get(`d${weekday}_on`) !== "on") continue;
    for (let n = 1; n <= MAX_SHIFTS_PER_DAY; n++) {
      const startMinute = optionalMinute(formData, `d${weekday}_s${n}`);
      const endMinute = optionalMinute(formData, `d${weekday}_e${n}`);
      if (startMinute === undefined || endMinute === undefined) continue;
      shifts.push({ weekday, startMinute, endMinute });
    }
  }

  const result = await setWeeklyHours(scope, membershipId, shifts);
  return result.ok ? { saved: true } : { error: result.error };
}

export async function addExceptionAction(
  businessId: string,
  membershipId: string,
  _prev: HoursFormState,
  formData: FormData,
): Promise<HoursFormState> {
  const scope = await scopeFor(businessId);
  if (!scope) return { error: "forbidden" };

  const startDate = String(formData.get("startDate") ?? "");
  const result = await addException(scope, membershipId, {
    kind: formData.get("kind") === "extra_hours" ? "extra_hours" : "time_off",
    startDate,
    // One day unless she gives a last day.
    endDate: String(formData.get("endDate") ?? "") || startDate,
    startMinute: optionalMinute(formData, "startMinute"),
    endMinute: optionalMinute(formData, "endMinute"),
    note: String(formData.get("note") ?? "") || undefined,
  });
  if (!result.ok) return { error: result.error };
  // Back to the same screen, so the list shows the new entry and the form is cleared.
  redirect(`/dashboard/${businessId}/hours/${membershipId}`);
}

export async function removeExceptionAction(
  businessId: string,
  membershipId: string,
  exceptionId: string,
) {
  const scope = await scopeFor(businessId);
  if (scope) await removeException(scope, exceptionId);
  redirect(`/dashboard/${businessId}/hours/${membershipId}`);
}

export async function addClosureAction(
  businessId: string,
  _prev: HoursFormState,
  formData: FormData,
): Promise<HoursFormState> {
  const scope = await scopeFor(businessId);
  if (!scope) return { error: "forbidden" };

  const startDate = String(formData.get("startDate") ?? "");
  const result = await addClosure(scope, {
    startDate,
    endDate: String(formData.get("endDate") ?? "") || startDate,
    reason: String(formData.get("reason") ?? "") || undefined,
  });
  if (!result.ok) return { error: result.error };
  redirect(`/dashboard/${businessId}/hours`);
}

export async function removeClosureAction(businessId: string, closureId: string) {
  const scope = await scopeFor(businessId);
  if (scope) await removeClosure(scope, closureId);
  redirect(`/dashboard/${businessId}/hours`);
}

/** The time rules, plus (in a solo practice) her travel buffer, from one form. */
export async function saveBookingRulesAction(
  businessId: string,
  travelBufferMembershipId: string | null,
  _prev: HoursFormState,
  formData: FormData,
): Promise<HoursFormState> {
  const scope = await scopeFor(businessId);
  if (!scope) return { error: "forbidden" };

  const rules = await updateBookingRules(scope, {
    minNoticeMinutes: Number(formData.get("minNoticeMinutes")),
    maxAdvanceDays: Number(formData.get("maxAdvanceDays")),
  });
  if (!rules.ok) return { error: rules.error };

  if (travelBufferMembershipId) {
    const travel = await setTravelBuffer(
      scope,
      travelBufferMembershipId,
      Number(formData.get("travelBufferMinutes")),
    );
    if (!travel.ok) return { error: travel.error };
  }
  return { saved: true };
}
