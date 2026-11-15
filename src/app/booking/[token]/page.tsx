import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ClientText } from "@/i18n/client-text";
import { formatDuration } from "@/lib/duration";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatTime } from "@/lib/time";
import { turnstileSiteKey } from "@/modules/abuse/turnstile";
import { getGuestBooking, type GuestBooking } from "@/modules/booking/engine";
import { cancelBookingAction } from "@/modules/booking/guest-actions";
import { DetailsForm } from "./details-form";

// A private page that changes as the booking does.
export const instant = false;

// The link is the key to the booking, so it must not end up in search results.
// and must not be passed on to other sites in a "came from" header.
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

async function Summary({ booking }: { booking: GuestBooking }) {
  const t = await getTranslations("booking");
  const tCommon = await getTranslations("common");
  const minutes = Math.round((booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000);

  return (
    <dl className="space-y-1 border-y border-line py-4">
      <dt className="sr-only">{booking.businessName}</dt>
      <dd className="title-sm">{booking.serviceName}</dd>
      <dd className="font-semibold">{formatDateTime(booking.startsAt, booking.timeZone)}</dd>
      <dd className="text-sm text-muted">{formatDuration(minutes, tCommon)}</dd>
      <dd className="text-sm text-muted">
        {booking.professionalName
          ? t("summaryWith", { name: booking.professionalName })
          : t("summaryAnyone")}
      </dd>
      <dd className="text-sm text-muted">
        {booking.atClientPlace ? t("summaryAtClientPlace") : booking.businessName}
      </dd>
      <dd className="font-bold tabular-nums">
        {formatMoney({ amount: booking.totalPrice, currency: booking.currency })}
      </dd>
    </dl>
  );
}

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ notice?: string }>;
}) {
  const [{ token }, { notice }] = await Promise.all([params, searchParams]);
  const booking = await getGuestBooking(token);
  if (!booking) notFound();

  const t = await getTranslations("booking");
  const { status } = booking;
  const bookAgain = booking.publicPath ? (
    <Link href={booking.publicPath} className="btn btn-primary">
      {t("bookAgain")}
    </Link>
  ) : null;

  return (
    <>
      <div className="band" aria-hidden="true" />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-5 py-8">
        {notice === "too_late" ? (
          <p className="rounded-md bg-warning-tint px-3 py-2 text-sm" role="status">
            {t("notices.too_late")}
          </p>
        ) : null}

        {status === "held" ? (
          <>
            <div className="space-y-1">
              <p className="text-sm text-muted">{booking.businessName}</p>
              <h1 className="title">{t("detailsTitle")}</h1>
            </div>
            <Summary booking={booking} />
            {booking.holdExpiresAt ? (
              <p className="rounded-md bg-primary-tint px-3 py-2 text-sm text-primary-dark" role="status">
                {t("heldUntil", { time: formatTime(booking.holdExpiresAt, booking.timeZone) })}
              </p>
            ) : null}
            <ClientText sections={["booking"]}>
              <DetailsForm
                token={token}
                atClientPlace={booking.atClientPlace}
                botCheckSiteKey={turnstileSiteKey()}
              />
            </ClientText>
            {booking.publicPath ? (
              <form action={cancelBookingAction.bind(null, token)}>
                <input type="hidden" name="next" value={booking.publicPath} />
                <button type="submit" className="link text-sm">
                  {t("chooseAnother")}
                </button>
              </form>
            ) : null}
          </>
        ) : status === "confirmed" || status === "pending_approval" || status === "arrived" ? (
          <>
            <div className="space-y-1">
              <h1 className="title-lg">
                {status === "pending_approval" ? t("pendingTitle") : t("confirmedTitle")}
              </h1>
              <p className="text-muted">
                {status === "pending_approval"
                  ? t("pendingBody", { business: booking.businessName })
                  : t("confirmedBody", { business: booking.businessName })}
              </p>
            </div>
            <Summary booking={booking} />
            <p className="text-sm text-muted">{t("keepLink")}</p>
            {booking.canCancel ? (
              <form action={cancelBookingAction.bind(null, token)} className="space-y-2">
                <button type="submit" className="btn btn-quiet">
                  {t("cancel")}
                </button>
                <p className="text-sm text-muted">{t("cancelHint")}</p>
              </form>
            ) : status === "arrived" ? null : (
              <p className="text-sm text-muted">{t("cancelClosed")}</p>
            )}
          </>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="title">
                {status === "cancelled"
                  ? t("cancelledTitle")
                  : status === "completed"
                    ? t("completedTitle")
                    : status === "no_show"
                      ? t("noShowTitle")
                      : t("expiredTitle")}
              </h1>
              {status === "cancelled" ? (
                <p className="text-muted">
                  {booking.cancelledBy === "customer" ? t("cancelledByYou") : t("cancelledByBusiness")}
                </p>
              ) : status === "expired" ? (
                <p className="text-muted">{t("expiredBody")}</p>
              ) : null}
            </div>
            {status === "expired" ? null : <Summary booking={booking} />}
            {bookAgain}
          </>
        )}
      </main>
    </>
  );
}
