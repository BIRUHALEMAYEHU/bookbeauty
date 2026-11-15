"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { normalisePhone } from "@/lib/phone";
import { consumeRateLimit, RATE_LIMITS } from "@/modules/abuse/rate-limit";
import { TURNSTILE_FIELD, verifyTurnstileToken } from "@/modules/abuse/turnstile";
import {
  cancelByGuest,
  getGuestBooking,
  holdSlot,
  loadBookingContext,
  submitBooking,
} from "./engine";

/** What customers do themselves, with no account (F15). */

async function clientIp() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
}

/** Only ever send her back to a page of ours. */
function safePath(value: FormDataEntryValue | null, fallback: string) {
  const path = typeof value === "string" ? value : "";
  return path.startsWith("/") && !path.startsWith("//") && !path.includes("\\") ? path : fallback;
}

function withNotice(path: string, notice: string) {
  return `${path}${path.includes("?") ? "&" : "?"}notice=${notice}`;
}

/** She tapped a time: reserve it and take her to the details form. */
export async function holdTimeAction(formData: FormData) {
  const back = safePath(formData.get("back"), "/");
  const startsAt = new Date(String(formData.get("startsAt") ?? ""));
  const context = await loadBookingContext(
    String(formData.get("businessId") ?? ""),
    String(formData.get("serviceId") ?? ""),
  );
  if (!context || Number.isNaN(startsAt.getTime())) redirect(withNotice(back, "taken"));

  const limit = await consumeRateLimit(RATE_LIMITS.bookingHoldIp(await clientIp()));
  if (!limit.ok) redirect(withNotice(back, "slow_down"));

  const result = await holdSlot(context, {
    startsAt,
    membershipId: String(formData.get("with") ?? "") || null,
    atClientPlace: formData.get("at") === "client",
    source: formData.get("source") === "professional_page" ? "professional_page" : "business_page",
  });
  // Either way the time is gone; the page she returns to shows what is left.
  if (!result.ok) redirect(withNotice(back, "taken"));
  redirect(`/booking/${result.token}`);
}

const DETAIL_FIELDS = ["name", "phone", "email", "notes", "allergies", "addressText"] as const;

/** On an error the form gets back what she typed, so she corrects one thing, not everything. */
export type DetailsFormState = {
  error?: string;
  values?: Partial<Record<(typeof DETAIL_FIELDS)[number], string>>;
};

/** She filled in her details: turn the hold into a booking. */
export async function submitDetailsAction(
  token: string,
  _prev: DetailsFormState,
  formData: FormData,
): Promise<DetailsFormState> {
  const values = Object.fromEntries(
    DETAIL_FIELDS.map((name) => [name, String(formData.get(name) ?? "")]),
  );
  const ip = await clientIp();
  const botToken = formData.get(TURNSTILE_FIELD);
  if (!(await verifyTurnstileToken(typeof botToken === "string" ? botToken : null, ip || null))) {
    return { error: "bot_check_failed", values };
  }

  const booking = await getGuestBooking(token);
  if (!booking) return { error: "not_found", values };

  const text = (name: string) => String(formData.get(name) ?? "");
  const phone = normalisePhone(text("phone"));
  if (!phone) return { error: "phone_invalid", values };

  const [byIp, byPhone] = await Promise.all([
    consumeRateLimit(RATE_LIMITS.bookingSubmitIp(ip)),
    consumeRateLimit(RATE_LIMITS.bookingSubmitPhone(`${booking.businessId}:${phone}`)),
  ]);
  if (!byIp.ok || !byPhone.ok) return { error: "rate_limited", values };

  const result = await submitBooking(token, {
    name: text("name"),
    phone: text("phone"),
    email: text("email").trim(),
    notes: text("notes") || undefined,
    allergies: text("allergies") || undefined,
    addressText: text("addressText") || undefined,
  });
  if (!result.ok) return { error: result.error, values };
  // The same link now shows her booking.
  redirect(`/booking/${token}`);
}

/** She cancels her booking, or lets go of a time she was holding. */
export async function cancelBookingAction(token: string, formData: FormData) {
  const result = await cancelByGuest(token);
  const next = safePath(formData.get("next"), `/booking/${token}`);
  redirect(result.ok ? next : withNotice(`/booking/${token}`, "too_late"));
}
