import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { listHats } from "@/modules/businesses/queries";
import { siteUrl } from "@/env";
import { localDateOf, zonedTimeToUtc } from "@/lib/time";
import { formatMoney } from "@/lib/money";
import { listUpcomingBookings } from "@/modules/booking/manage";
import { getIncome, monthOf } from "@/modules/income/income";
import { currentScope } from "./current-scope";

async function Overview({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { user, scope } = await currentScope(businessId);
  const t = await getTranslations("dashboard");
  const tRoles = await getTranslations("roles");

  const hat = (await listHats(user.id)).find((h) => h.businessId === businessId);
  const bookingLink = hat?.publicPath ? siteUrl(hat.publicPath) : null;

  const tBookings = await getTranslations("bookings");
  const { timeZone } = await scope.business();
  const now = new Date();
  const waiting = (
    await listUpcomingBookings(scope, zonedTimeToUtc(localDateOf(now, timeZone), 0, timeZone), now)
  ).filter((booking) => booking.status === "pending_approval").length;
  // Null for those who may not see income (front desk).
  const income = await getIncome(scope, monthOf(localDateOf(now, timeZone)));
  const tIncome = await getTranslations("income");

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="title">
          {t("welcome", { name: user.displayName })}
        </h1>
        <p className="text-sm text-muted">
          {t("yourRole", { role: tRoles(scope.actor.role) })}
        </p>
      </div>

      {waiting > 0 ? (
        <p className="rounded-md bg-warning-tint px-3 py-3 text-sm" role="status">
          {tBookings("overviewPending", { count: waiting })}{" "}
          <Link href={`/dashboard/${businessId}/bookings`} className="link">
            {tBookings("overviewOpen")}
          </Link>
        </p>
      ) : null}

      {income && income.visits > 0 ? (
        <p className="text-sm">
          {tIncome("overview", {
            amount: formatMoney({ amount: income.total, currency: income.currency }),
            count: income.visits,
          })}{" "}
          <Link href={`/dashboard/${businessId}/income`} className="link">
            {tIncome("overviewLink")}
          </Link>
        </p>
      ) : null}

      <section className="space-y-3 border-y border-line py-5">
        <h2 className="title-sm">{t("bookingLink")}</h2>
        {bookingLink ? (
          <>
            <p className="break-all rounded-md bg-wash px-3 py-2.5 font-semibold">
              {bookingLink}
            </p>
            <p className="text-sm text-muted">{t("bookingLinkHint")}</p>
            <p className="flex flex-wrap gap-3">
              <a href={bookingLink} className="btn btn-primary btn-small">
                {t("viewPage")}
              </a>
              {scope.can("settings.manage") ? (
                <Link href={`/dashboard/${businessId}/page-settings`} className="btn btn-quiet btn-small">
                  {t("editPage")}
                </Link>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted">{t("bookingLinkMissing")}</p>
        )}
      </section>
    </div>
  );
}

export default function BusinessDashboardPage({ params }: PageProps<"/dashboard/[businessId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Overview params={params} />
    </Suspense>
  );
}
