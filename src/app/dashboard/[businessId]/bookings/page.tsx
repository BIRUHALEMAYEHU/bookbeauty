import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { formatDate, formatTime, localDateOf, zonedTimeToUtc } from "@/lib/time";
import { listUpcomingBookings, type StaffBooking } from "@/modules/booking/manage";
import {
  approveBookingAction,
  cancelBookingByBusinessAction,
  setApprovalModeAction,
} from "@/modules/booking/manage-actions";
import { grantFor } from "@/modules/identity/permissions";
import { currentScope } from "../current-scope";

const NOTICES = ["forbidden", "not_found", "wrong_status"] as const;

async function BookingCard({
  booking,
  businessId,
  timeZone,
  canAct,
}: {
  booking: StaffBooking;
  businessId: string;
  timeZone: string;
  canAct: boolean;
}) {
  const t = await getTranslations("bookings");
  const pending = booking.status === "pending_approval";

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

      {canAct ? (
        <div className="flex flex-wrap items-start gap-3 pt-1">
          {pending ? (
            <form action={approveBookingAction.bind(null, businessId, booking.id)}>
              <button type="submit" className="btn btn-primary btn-small">
                {t("approve")}
              </button>
            </form>
          ) : null}
          {/* Two taps to cancel: opening this, then confirming. */}
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
        </div>
      ) : null}
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
  const now = new Date();
  const startOfToday = zonedTimeToUtc(localDateOf(now, business.timeZone), 0, business.timeZone);

  const all = await listUpcomingBookings(scope, startOfToday, now);
  const pending = all.filter((booking) => booking.status === "pending_approval");
  const upcoming = all.filter((booking) => booking.status !== "pending_approval");
  const ownOnly = grantFor(scope.actor.role, "bookings.view") === "own";
  const canAct = (booking: StaffBooking) =>
    scope.can("bookings.create", { professionalUserId: booking.professionalUserId });
  const shownNotice = NOTICES.find((value) => value === notice);

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
              <ul className="divide-y divide-line border-y border-line">
                {pending.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    businessId={businessId}
                    timeZone={business.timeZone}
                    canAct={canAct(booking)}
                  />
                ))}
              </ul>
            </section>
          ) : null}

          <section className="space-y-2">
            <h2 className="title-sm">{t("upcomingTitle")}</h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">{t("emptyUpcoming")}</p>
            ) : (
              <ul className="divide-y divide-line border-y border-line">
                {upcoming.map((booking) => (
                  <BookingCard
                    key={booking.id}
                    booking={booking}
                    businessId={businessId}
                    timeZone={business.timeZone}
                    canAct={canAct(booking)}
                  />
                ))}
              </ul>
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
