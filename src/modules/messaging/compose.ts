import "server-only";
import { createTranslator } from "next-intl";
import { appUrl, siteUrl } from "@/env";
import type { EmailMessage } from "@/integrations/email";
import { formatDuration } from "@/lib/duration";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatDateTime } from "@/lib/time";
import en from "@/messages/en.json";
import type { MessageKind } from "@/db/schema";

/**
 * The words of each booking message (D103: fixed platform wording in Layer 1),
 * from the "notifications" section of en.json.
 */

export type BookingFacts = {
  businessId: string;
  businessName: string;
  timeZone: string;
  serviceName: string;
  startsAt: Date;
  durationMinutes: number;
  /** Only when the customer chose her; "Any available" stays unnamed to the customer. */
  professionalName: string | null;
  /** Who is actually doing it, for messages to the business. */
  assignedName: string | null;
  customerName: string;
  customerPhone: string | null;
  atClientPlace: boolean;
  addressText: string | null;
  totalPrice: number;
  currency: string;
  status: string;
};

const t = createTranslator({ locale: "en", messages: en, namespace: "notifications" });
const tCommon = createTranslator({ locale: "en", messages: en, namespace: "common" });

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The lines that describe the visit, the same in every message. */
function visitLines(facts: BookingFacts, forBusiness: boolean) {
  const lines = [
    facts.serviceName,
    formatDateTime(facts.startsAt, facts.timeZone),
    formatDuration(facts.durationMinutes, tCommon),
  ];
  const who = forBusiness ? facts.assignedName : facts.professionalName;
  if (who) lines.push(t("with", { name: who }));
  if (facts.atClientPlace) {
    lines.push(forBusiness ? t("atCustomerAddress", { address: facts.addressText ?? "" }) : t("atYourPlace"));
  } else {
    lines.push(facts.businessName);
  }
  lines.push(formatMoney({ amount: facts.totalPrice, currency: facts.currency }));
  return lines;
}

type Body = { subject: string; intro: string; outro?: string; link?: { label: string; url: string } };

function customerBody(kind: MessageKind, facts: BookingFacts, linkToken: string | null): Body {
  const business = facts.businessName;
  const link = linkToken
    ? { label: t("openBooking"), url: siteUrl(`/booking/${linkToken}`) }
    : undefined;
  switch (kind) {
    case "booking_confirmation":
      return { subject: t("confirmation.subject", { business }), intro: t("confirmation.intro", { business }), outro: t("keepLink"), link };
    case "booking_request_received":
      return { subject: t("request.subject", { business }), intro: t("request.intro", { business }), outro: t("keepLink"), link };
    case "booking_approved":
      return { subject: t("approved.subject", { business }), intro: t("approved.intro", { business }), outro: t("useFirstEmail") };
    case "booking_declined":
      return { subject: t("declined.subject", { business }), intro: t("declined.intro", { business }) };
    case "booking_cancelled_by_business":
      return { subject: t("cancelledByBusiness.subject", { business }), intro: t("cancelledByBusiness.intro", { business }) };
    case "booking_reminder":
      return { subject: t("reminder.subject", { business }), intro: t("reminder.intro", { business }), outro: t("useFirstEmail") };
    default:
      throw new Error(`Not a customer message: ${kind}`);
  }
}

function businessBody(kind: MessageKind, facts: BookingFacts): Body {
  const customer = facts.customerName;
  const link = { label: t("openDashboard"), url: appUrl(`/dashboard/${facts.businessId}/bookings`) };
  const phone = facts.customerPhone ? formatPhone(facts.customerPhone) : "";
  switch (kind) {
    case "new_booking_notice":
      return facts.status === "pending_approval"
        ? { subject: t("newRequest.subject", { customer }), intro: t("newRequest.intro", { customer, phone }), link }
        : { subject: t("newBooking.subject", { customer }), intro: t("newBooking.intro", { customer, phone }), link };
    case "booking_cancelled_notice":
      return { subject: t("customerCancelled.subject", { customer }), intro: t("customerCancelled.intro", { customer, phone }), link };
    default:
      throw new Error(`Not a business message: ${kind}`);
  }
}

export const BUSINESS_KINDS: MessageKind[] = ["new_booking_notice", "booking_cancelled_notice"];

/** The email for one message, worded for whoever receives it. */
export function composeEmail(
  kind: MessageKind,
  facts: BookingFacts,
  to: { email: string; name: string },
  linkToken: string | null,
  /** The same words go to Telegram as plain text, with a signature that fits a chat. */
  channel: "email" | "telegram" = "email",
): EmailMessage {
  const forBusiness = BUSINESS_KINDS.includes(kind);
  const body = forBusiness ? businessBody(kind, facts) : customerBody(kind, facts, linkToken);
  const greeting = t("greeting", { name: to.name });
  const visit = visitLines(facts, forBusiness);
  const signature = channel === "telegram" ? t("signatureTelegram") : t("signature");

  const text = [
    greeting,
    "",
    body.intro,
    "",
    ...visit,
    ...(body.link ? ["", `${body.link.label}: ${body.link.url}`] : []),
    ...(body.outro ? ["", body.outro] : []),
    "",
    signature,
  ].join("\n");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(body.intro)}</p>`,
    `<p><strong>${escapeHtml(visit[0]!)}</strong><br>${visit.slice(1).map(escapeHtml).join("<br>")}</p>`,
    body.link ? `<p><a href="${escapeHtml(body.link.url)}">${escapeHtml(body.link.label)}</a></p>` : "",
    body.outro ? `<p>${escapeHtml(body.outro)}</p>` : "",
    `<p>${escapeHtml(signature)}</p>`,
  ]
    .filter(Boolean)
    .join("\n");

  return { to: to.email, subject: body.subject, text, html };
}
