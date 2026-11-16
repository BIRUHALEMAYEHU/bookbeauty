import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { addDays, formatDate, formatTime, localDateOf, zonedTimeToUtc } from "@/lib/time";
import {
  listUpcomingBookings,
  PAYMENT_METHODS,
  type StaffBooking,
} from "@/modules/booking/manage";
import {
  approveBookingAction,
  cancelBookingByBusinessAction,
  completeBookingAction,
  markArrivedAction,
  markNoShowAction,
  setApprovalModeAction,
} from "@/modules/booking/manage-actions";
import { grantFor } from "@/modules/identity/permissions";
import { currentScope } from "../current-scope";

const NOTICES = [
  "forbidden",
  "not_found",
  "wrong_status",
  "not_started",
  "amount_invalid",
  "method_invalid",
] as const;

/** How far back unfinished visits are listed. Older ones are left as they are. */
const UNFINISHED_DAYS = 30;
/** "Arrived" shows from this long before the start. */
const ARRIVED_FROM_MS = 12 * 60 * 60_000;

/** Santim as she would type it: "350" or "1250.50". */
function birr(amount: number) {
  return amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2);
}

async function BookingCard({
  booking,
  businessId,
  timeZone,
  now,
  canAnswer,
  canClose,
}: {
  booking: StaffBooking;
  businessId: string;
  timeZone: string;
  now: Date;
  /** May approve, decline or cancel it. */
  canAnswer: boolean;
  /** May mark it arrived, completed or missed. */
  canClose: boolean;
}) {
  const t = await getTranslations("bookings");
  const pending = booking.status === "pending_approval";
  const started = booking.startsAt <= now;
  const showArrived =
    canClose &&
    booking.status === "confirmed" &&
    booking.startsAt.getTime() - now.getTime() <= ARRIVED_FROM_MS &&
    // Once the visit is over, "arrived" no longer helps; complete it instead.
    booking.endsAt > now;
  const showClose = canClose && started && !pending;
  const showCancel = canAnswer && (pending || (booking.status === "confirmed" && !started));

  return (
    <li className="space-y-2 py-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="font-bold tabular-nums">
          {formatTime(booking.startsAt, timeZone)}
          <span className="font-normal text-muted">{` ${formatDate(booking.startsAt, timeZone)}`}</span>
        </p>
        <p className="flex-none font-semibold tabular-nums">
          {formatMoney({ amount: booking.totalPrice, currency: booking.currency })}
        </p>
      </div>
      <p className="font-semibold">
        {booking.serviceName}
        {booking.status === "arrived" ? (
          <span className="ml-2 rounded bg-primary-tint px-2 py-0.5 text-xs text-primary-dark">
            {t("arrived")}
          </span>
        ) : null}
      </p>
      <p>
        {booking.customerName}
        {booking.customerPhone ? (
          <>
            {" "}
            <a href={`tel:${booking.customerPhone}`} className="link">
              {formatPhone(booking.customerPhone)}
            </a>
          </>
        ) : null}
      </p>
      {booking.professionalName ? (
        <p className="text-sm text-muted">
          {booking.assignment === "auto"
            ? t("withPicked", { name: booking.professionalName })
            : t("with", { name: booking.professionalName })}
        </p>
      ) : null}
      {booking.atClientPlace ? (
        <p className="text-sm text-muted">
          {t("atClientPlace", { address: booking.clientAddressText ?? "" })}
        </p>
      ) : null}
      {booking.allergies ? (
        <p className="whitespace-pre-line rounded-md bg-warning-tint px-3 py-2 text-sm">
          {t("allergies", { text: booking.allergies })}
        </p>
      ) : null}
      {booking.customerNotes ? (
        <p className="whitespace-pre-line text-sm text-muted">
          {t("notes", { text: booking.customerNotes })}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start gap-3 pt-1">
        {canAnswer && pending ? (
          <form action={approveBookingAction.bind(null, businessId, booking.id)}>
            <button type="submit" className="btn btn-primary btn-small">
              {t("approve")}
            </button>
          </form>
        ) : null}

        {showArrived ? (
          <form action={markArrivedAction.bind(null, businessId, booking.id)}>
            <button type="submit" className="btn btn-quiet btn-small">
              {t("markArrived")}
            </button>
          </form>
        ) : null}

        {showClose ? (
          <details className="w-full space-y-3 sm:w-auto">
            <summary className="btn btn-primary btn-small list-none">{t("complete")}</summary>
            <form
              action={completeBookingAction.bind(null, businessId, booking.id)}
              className="max-w-sm space-y-3"
            >
              <p className="font-semibold">{t("completeTitle")}</p>
              <label className="field">
                <span>{t("amountPaid")}</span>
                <input
                  name="amountPaid"
                  required
                  inputMode="decimal"
                  maxLength={12}
                  defaultValue={birr(booking.totalPrice)}
                  className="field-input"
                />
              </label>
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">{t("paymentMethod")}</legend>
                <div className="flex flex-wrap gap-2">
                  {PAYMENT_METHODS.map((method) => (
                    <label key={method} className="choice">
                      <input type="radio" name="paymentMethod" value={method} required />
                      <span>{t(`methods.${method}`)}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="btn btn-primary">
                {t("completeSave")}
              </button>
            </form>
          </details>
        ) : null}

        {showClose && booking.status === "confirmed" ? (
          <details className="space-y-2">
            <summary className="btn btn-quiet btn-small list-none">{t("noShow")}</summary>
            <p className="max-w-sm text-sm text-muted">{t("noShowWarning")}</p>
            <form action={markNoShowAction.bind(null, businessId, booking.id)}>
              <button type="submit" className="link text-sm text-danger">
                {t("noShowConfirm")}
              </button>
            </form>
          </details>
        ) : null}

        {showCancel ? (
          // Two taps to cancel: opening this, then confirming.
          <details className="space-y-2">
            <summary className="btn btn-quiet btn-small list-none">
              {pending ? t("decline") : t("cancel")}
            </summary>
            <p className="max-w-sm text-sm text-muted">{t("cancelWarning")}</p>
            <form action={cancelBookingByBusinessAction.bind(null, businessId, booking.id)}>
              <button type="submit" className="link text-sm text-danger">
                {pending ? t("declineConfirm") : t("cancelConfirm")}
              </button>
            </form>
          </details>
        ) : null}
      </div>
    </li>
  );
}

async function Bookings({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ businessId }, { notice }] = await Promise.all([params, searchParams]);
  const { scope } = await currentScope(businessId);
  const t = await getTranslations("bookings");
  const business = await scope.business();
  const { timeZone } = business;
  const now = new Date();
  const today = localDateOf(now, timeZone);
  const startOfToday = zonedTimeToUtc(today, 0, timeZone);
  const startOfTomorrow = zonedTimeToUtc(addDays(today, 1), 0, timeZone);

  const all = await listUpcomingBookings(
    scope,
    zonedTimeToUtc(addDays(today, -UNFINISHED_DAYS), 0, timeZone),
    now,
  );
  const pending = all.filter((booking) => booking.status === "pending_approval");
  const visits = all.filter((booking) => booking.status !== "pending_approval");
  const unfinished = visits.filter((booking) => booking.startsAt < startOfToday);
  const todays = visits.filter(
    (booking) => booking.startsAt >= startOfToday && booking.startsAt < startOfTomorrow,
  );
  const later = visits.filter((booking) => booking.startsAt >= startOfTomorrow);

  const ownOnly = grantFor(scope.actor.role, "bookings.view") === "own";
  const shownNotice = NOTICES.find((value) => value === notice);
  const card = (booking: StaffBooking) => (
    <BookingCard
      key={booking.id}
      booking={booking}
      businessId={businessId}
      timeZone={timeZone}
      now={now}
      canAnswer={scope.can("bookings.create", { professionalUserId: booking.professionalUserId })}
      canClose={scope.can("bookings.complete", { professionalUserId: booking.professionalUserId })}
    />
  );

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="title">{t("title")}</h1>
        <p className="text-sm text-muted">{ownOnly ? t("subtitleOwn") : t("subtitle")}</p>
      </div>

      {shownNotice ? (
        <p className="rounded-md bg-warning-tint px-3 py-2 text-sm" role="status">
          {t(`notices.${shownNotice}`)}
        </p>
      ) : null}

      {all.length === 0 ? (
        <p className="border-y border-line py-6 text-muted">{t("empty")}</p>
      ) : (
        <>
          {pending.length > 0 ? (
            <section className="space-y-2">
              <h2 className="title-sm">{t("pendingTitle", { count: pending.length })}</h2>
              <p className="text-sm text-muted">{t("pendingHint")}</p>
              <ul className="divide-y divide-line border-y border-line">{pending.map(card)}</ul>
            </section>
          ) : null}

          {unfinished.length > 0 ? (
            <section className="space-y-2">
              <h2 className="title-sm">{t("unfinishedTitle", { count: unfinished.length })}</h2>
              <p className="text-sm text-muted">{t("unfinishedHint")}</p>
              <ul className="divide-y divide-line border-y border-line">{unfinished.map(card)}</ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="title-sm">{t("todayTitle")}</h2>
            {todays.length === 0 ? (
              <p className="text-sm text-muted">{t("todayEmpty")}</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">{todays.map(card)}</ul>
            )}
          </section>

          <section className="space-y-2">
            <h2 className="title-sm">{t("upcomingTitle")}</h2>
            {later.length === 0 ? (
              <p className="text-sm text-muted">{t("emptyUpcoming")}</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">{later.map(card)}</ul>
            )}
          </section>
        </>
      )}

      {scope.can("settings.manage") ? (
        <section className="max-w-xl space-y-3">
          <h2 className="title-sm">{t("modeTitle")}</h2>
          <form action={setApprovalModeAction.bind(null, businessId)} className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <label className="choice">
                <input
                  type="radio"
                  name="mode"
                  value="auto"
                  defaultChecked={business.approvalMode === "auto"}
                />
                <span>{t("modeAuto")}</span>
              </label>
              <label className="choice">
                <input
                  type="radio"
                  name="mode"
                  value="manual"
                  defaultChecked={business.approvalMode === "manual"}
                />
                <span>{t("modeManual")}</span>
              </label>
            </div>
            <p className="text-sm text-muted">{t("modeHint")}</p>
            <button type="submit" className="btn btn-quiet btn-small">
              {t("modeSave")}
            </button>
          </form>
        </section>
      ) : null}
    </div>
  );
}

export default function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Bookings params={params} searchParams={searchParams} />
    </Suspense>
  );
}
