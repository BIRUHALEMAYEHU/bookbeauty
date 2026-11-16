import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatDate, formatDateTime } from "@/lib/time";
import {
  addNoteAction,
  deleteNoteAction,
  splitCustomerAction,
  updateCustomerAction,
} from "@/modules/customers/actions";
import { PAYMENT_METHODS } from "@/modules/booking/manage";
import { getCustomer, type HistoryEntry } from "@/modules/customers/records";
import { currentScope } from "../../current-scope";

const NOTICES = [
  "saved",
  "split",
  "forbidden",
  "not_found",
  "invalid_input",
  "phone_invalid",
  "nothing_to_split",
] as const;

async function Customer({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; customerId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ businessId, customerId }, { notice }] = await Promise.all([params, searchParams]);
  const { scope, user } = await currentScope(businessId);
  const detail = await getCustomer(scope, customerId);
  if (!detail) notFound();

  const [t, tBookings, business] = await Promise.all([
    getTranslations("customers"),
    getTranslations("bookings"),
    scope.business(),
  ]);
  const { record, history, notes, canManage } = detail;
  const { timeZone } = business;
  const money = (amount: number) => formatMoney({ amount, currency: "ETB" });
  const shownNotice = NOTICES.find((value) => value === notice);
  const statusLabel = (entry: HistoryEntry) =>
    entry.status === "cancelled" && entry.cancelledBy === "customer"
      ? t("status.cancelledByCustomer")
      : t(`status.${entry.status as Exclude<HistoryEntry["status"], "held" | "expired" | "awaiting_deposit">}`);
  const methodLabel = (method: string | null) =>
    PAYMENT_METHODS.find((value) => value === method)
      ? tBookings(`methods.${method as (typeof PAYMENT_METHODS)[number]}`)
      : (method ?? "");
  // A booking typed under another name is the usual sign of a shared phone.
  const otherNames = history.some(
    (entry) => entry.bookedAsName && entry.bookedAsName.trim().toLowerCase() !== record.name.trim().toLowerCase(),
  );

  return (
    <div className="max-w-xl space-y-8">
      <div className="space-y-2">
        <Link href={`/dashboard/${businessId}/customers`} className="link text-sm">
          {t("back")}
        </Link>
        <h1 className="title">{record.name}</h1>
        <p>
          <a href={`tel:${record.phone}`} className="link">
            {formatPhone(record.phone)}
          </a>
          {record.email ? <span className="text-muted">{` ${record.email}`}</span> : null}
        </p>
        <p className="text-sm text-muted">
          {[
            t("visits", { count: record.visitCount }),
            record.totalSpent > 0 ? t("spent", { amount: money(record.totalSpent) }) : null,
            record.lastVisitAt ? t("lastVisit", { date: formatDate(record.lastVisitAt, timeZone) }) : null,
            record.noShowCount > 0 ? t("noShows", { count: record.noShowCount }) : null,
            record.cancellationCount > 0 ? t("cancellations", { count: record.cancellationCount }) : null,
          ]
            .filter(Boolean)
            .join(", ")}
        </p>
      </div>

      {shownNotice ? (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            shownNotice === "saved" || shownNotice === "split"
              ? "bg-primary-tint text-primary-dark"
              : "bg-warning-tint"
          }`}
          role="status"
        >
          {t(`notices.${shownNotice}`)}
        </p>
      ) : null}

      <section className="space-y-1">
        <h2 className="title-sm">{t("allergies")}</h2>
        {record.allergies ? (
          <p className="whitespace-pre-line rounded-md bg-warning-tint px-3 py-2">{record.allergies}</p>
        ) : (
          <p className="text-sm text-muted">{t("allergiesNone")}</p>
        )}
        <p className="text-xs text-muted">{t("allergiesHint")}</p>
      </section>

      <section className="space-y-3">
        <h2 className="title-sm">{t("notesTitle")}</h2>
        <p className="text-sm text-muted">{t("notesHint")}</p>
        {notes.length === 0 ? (
          <p className="text-sm text-muted">{t("notesEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {notes.map((note) => (
              <li key={note.id} className="space-y-1 py-3">
                <p className="whitespace-pre-line">{note.body}</p>
                {/* A div, not a p: a form inside a paragraph is not valid HTML, and
                    the browser's repair makes React redraw the page, losing typed text. */}
                <div className="flex items-center justify-between gap-3 text-xs text-muted">
                  <span>{t("noteBy", { name: note.authorName, date: formatDateTime(note.createdAt, timeZone) })}</span>
                  {note.authorUserId === user.id ? (
                    <form action={deleteNoteAction.bind(null, businessId, record.id, note.id)}>
                      <button type="submit" className="link text-xs">
                        {t("deleteNote")}
                      </button>
                    </form>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
        <form action={addNoteAction.bind(null, businessId, record.id)} className="space-y-2">
          <textarea
            name="body"
            required
            rows={2}
            maxLength={2000}
            placeholder={t("notePlaceholder")}
            aria-label={t("addNote")}
            className="field-input"
          />
          <button type="submit" className="btn btn-quiet btn-small">
            {t("addNote")}
          </button>
        </form>
      </section>

      <section className="space-y-3">
        <h2 className="title-sm">{t("historyTitle")}</h2>
        {history.length === 0 ? (
          <p className="text-sm text-muted">{t("historyEmpty")}</p>
        ) : (
          <ul className="divide-y divide-line border-y border-line">
            {history.map((entry) => (
              <li key={entry.bookingId} className="space-y-0.5 py-3">
                <p className="flex justify-between gap-3">
                  <span className="font-semibold">{entry.serviceName}</span>
                  <span className="flex-none text-sm text-muted">{statusLabel(entry)}</span>
                </p>
                <p className="text-sm text-muted">
                  {formatDateTime(entry.startsAt, timeZone)}
                  {entry.professionalName ? `, ${tBookings("with", { name: entry.professionalName })}` : ""}
                </p>
                {entry.amountPaid !== null ? (
                  <p className="text-sm tabular-nums">
                    {t("paid", { amount: money(entry.amountPaid), method: methodLabel(entry.paymentMethod) })}
                  </p>
                ) : null}
                {entry.bookedAsName && entry.bookedAsName !== record.name ? (
                  <p className="text-sm text-muted">{t("bookedAs", { name: entry.bookedAsName })}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {canManage ? (
        <section className="space-y-3">
          <details className="space-y-3">
            <summary className="btn btn-quiet btn-small list-none">{t("editDetails")}</summary>
            <form action={updateCustomerAction.bind(null, businessId, record.id)} className="space-y-4">
              <h2 className="title-sm">{t("contactTitle")}</h2>
              <label className="field">
                <span>{t("name")}</span>
                <input name="name" required minLength={2} maxLength={100} defaultValue={record.name} className="field-input" />
              </label>
              <label className="field">
                <span>{t("phone")}</span>
                <input name="phone" type="tel" required maxLength={40} defaultValue={formatPhone(record.phone)} className="field-input" />
              </label>
              <label className="field">
                <span>{t("email")}</span>
                <input name="email" type="email" maxLength={200} defaultValue={record.email ?? ""} className="field-input" />
              </label>
              <label className="field">
                <span>{t("dateOfBirth")}</span>
                <input name="dateOfBirth" type="date" defaultValue={record.dateOfBirth ?? ""} className="field-input" />
              </label>
              <label className="field">
                <span>{t("allergies")}</span>
                <textarea name="allergies" rows={2} maxLength={500} defaultValue={record.allergies ?? ""} className="field-input" />
                <span className="text-xs text-muted">{t("allergiesHint")}</span>
              </label>
              <button type="submit" className="btn btn-primary">
                {t("saveDetails")}
              </button>
            </form>
          </details>
        </section>
      ) : null}

      {canManage && history.length > 1 ? (
        <section className="space-y-3 border-t border-line pt-5">
          <details className="space-y-3" open={otherNames}>
            <summary className="link cursor-pointer text-sm">{t("splitTitle")}</summary>
            <p className="text-sm text-muted">{t("splitHint")}</p>
            <form action={splitCustomerAction.bind(null, businessId, record.id)} className="space-y-3">
              <ul className="space-y-2">
                {history.map((entry) => (
                  <li key={entry.bookingId}>
                    <label className="flex items-start gap-3 text-sm">
                      <input
                        type="checkbox"
                        name="bookingIds"
                        value={entry.bookingId}
                        className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                      />
                      <span>
                        <span className="block font-semibold">
                          {entry.serviceName}, {formatDate(entry.startsAt, timeZone)}
                        </span>
                        {entry.bookedAsName ? (
                          <span className="block text-muted">{t("bookedAs", { name: entry.bookedAsName })}</span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              <label className="field">
                <span>{t("splitName")}</span>
                <input name="name" required minLength={2} maxLength={100} className="field-input" />
              </label>
              <button type="submit" className="btn btn-quiet">
                {t("splitButton")}
              </button>
            </form>
          </details>
        </section>
      ) : null}
    </div>
  );
}

export default function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string; customerId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Customer params={params} searchParams={searchParams} />
    </Suspense>
  );
}
