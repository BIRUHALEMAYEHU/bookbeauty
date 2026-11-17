import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { formatDateTime, formatMonth, localDateOf } from "@/lib/time";
import { PAYMENT_METHODS } from "@/modules/booking/manage";
import { getIncome, isMonth, monthOf, shiftMonth, type IncomeLine } from "@/modules/income/income";
import { currentScope } from "../current-scope";

async function Breakdown({
  title,
  lines,
  label,
  currency,
}: {
  title: string;
  lines: IncomeLine[];
  label: (line: IncomeLine) => string;
  currency: string;
}) {
  const t = await getTranslations("income");
  if (lines.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="title-sm">{title}</h2>
      <ul className="divide-y divide-line border-y border-line">
        {lines.map((line) => (
          <li key={line.key} className="flex items-baseline justify-between gap-3 py-2.5">
            <span className="min-w-0">
              <span className="font-semibold">{label(line)}</span>
              <span className="text-sm text-muted">{` ${t("visitCount", { count: line.visits })}`}</span>
            </span>
            <span className="flex-none font-semibold tabular-nums">
              {formatMoney({ amount: line.amount, currency })}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

async function Income({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  const [{ businessId }, { month: asked }] = await Promise.all([params, searchParams]);
  const { scope } = await currentScope(businessId);
  const business = await scope.business();
  const thisMonth = monthOf(localDateOf(new Date(), business.timeZone));
  const month = asked && isMonth(asked) && asked <= thisMonth ? asked : thisMonth;

  const report = await getIncome(scope, month);
  if (!report) notFound();

  const [t, tBookings] = await Promise.all([getTranslations("income"), getTranslations("bookings")]);
  const money = (amount: number) => formatMoney({ amount, currency: report.currency });
  const methodLabel = (key: string) =>
    PAYMENT_METHODS.find((value) => value === key)
      ? tBookings(`methods.${key as (typeof PAYMENT_METHODS)[number]}`)
      : key;
  const monthHref = (value: string) => `/dashboard/${businessId}/income?month=${value}`;
  const figures = [
    { label: t("total"), value: money(report.total) },
    { label: t("visits"), value: String(report.visits) },
    { label: t("average"), value: report.visits ? money(report.average) : "–" },
  ];

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className="title">{t("title")}</h1>
        <p className="text-sm text-muted">{report.ownOnly ? t("subtitleOwn") : t("subtitle")}</p>
      </div>

      <nav className="flex items-center justify-between gap-3" aria-label={t("title")}>
        <Link href={monthHref(shiftMonth(month, -1))} className="btn btn-quiet btn-small" aria-label={t("previous")}>
          ←
        </Link>
        <h2 className="title-sm">{formatMonth(month)}</h2>
        {month < thisMonth ? (
          <Link href={monthHref(shiftMonth(month, 1))} className="btn btn-quiet btn-small" aria-label={t("next")}>
            →
          </Link>
        ) : (
          <span className="w-11" />
        )}
      </nav>

      {report.visits === 0 ? (
        <p className="border-y border-line py-6 text-muted">{t("empty", { month: formatMonth(month) })}</p>
      ) : (
        <>
          <dl className="grid grid-cols-3 divide-x divide-line border-y border-line">
            {figures.map((figure) => (
              <div key={figure.label} className="px-2 py-4 text-center first:pl-0 last:pr-0">
                <dt className="text-xs text-muted">{figure.label}</dt>
                <dd className="title-sm mt-1 tabular-nums">{figure.value}</dd>
              </div>
            ))}
          </dl>

          <Breakdown
            title={t("byMethod")}
            lines={report.byMethod}
            label={(line) => methodLabel(line.key)}
            currency={report.currency}
          />
          <Breakdown title={t("byService")} lines={report.byService} label={(line) => line.label} currency={report.currency} />
          {report.byProfessional.length > 1 ? (
            <Breakdown
              title={t("byProfessional")}
              lines={report.byProfessional}
              label={(line) => line.label || t("unassigned")}
              currency={report.currency}
            />
          ) : null}

          <section className="space-y-2">
            <h2 className="title-sm">{t("visitsTitle")}</h2>
            <ul className="divide-y divide-line border-y border-line">
              {report.entries.map((entry) => (
                <li key={entry.bookingId} className="flex items-start justify-between gap-3 py-3">
                  <span className="min-w-0 space-y-0.5">
                    <span className="block font-semibold">{entry.serviceName}</span>
                    <span className="block text-sm text-muted">
                      {formatDateTime(entry.startsAt, business.timeZone)}
                      {entry.professionalName && !report.ownOnly ? `, ${entry.professionalName}` : ""}
                    </span>
                    {entry.customerName ? <span className="block text-sm">{entry.customerName}</span> : null}
                  </span>
                  <span className="flex-none text-right">
                    <span className="block font-semibold tabular-nums">{money(entry.amountPaid)}</span>
                    <span className="block text-sm text-muted">{methodLabel(entry.paymentMethod)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}

export default function IncomePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ month?: string }>;
}) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Income params={params} searchParams={searchParams} />
    </Suspense>
  );
}
