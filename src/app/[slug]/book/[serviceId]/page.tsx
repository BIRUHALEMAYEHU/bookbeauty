import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { formatDuration } from "@/lib/duration";
import { formatMoney } from "@/lib/money";
import {
  addDays,
  formatDate,
  formatShortDay,
  formatTime,
  isLocalDate,
  localDateOf,
  zonedTimeToUtc,
} from "@/lib/time";
import { getOpenSlots, loadBookingContext, priceFor } from "@/modules/booking/engine";
import { holdTimeAction } from "@/modules/booking/guest-actions";
import { publicBusinessPage, publicProfilePage } from "../../data";

// Open times change by the minute, so this page is worked out on every visit.
export const instant = false;

export const metadata: Metadata = { robots: { index: false } };

const DAYS_SHOWN = 7;
const NOTICES = ["taken", "slow_down"] as const;

/** The business behind "/slug" or "/@handle" (her own practice). */
async function resolvePlace(raw: string) {
  const decoded = decodeURIComponent(raw);
  if (decoded.startsWith("@")) {
    const page = await publicProfilePage(decoded.slice(1));
    const own = page?.places.find((place) => place.kind === "independent");
    if (!page || !own) return null;
    return {
      businessId: own.businessId,
      name: page.displayName,
      path: `/@${page.handle}`,
      source: "professional_page" as const,
    };
  }
  const page = await publicBusinessPage(decoded);
  if (!page) return null;
  return {
    businessId: page.id,
    name: page.name,
    path: `/${page.slug}`,
    source: "business_page" as const,
  };
}

type Search = { at?: string; with?: string; start?: string; date?: string; notice?: string };

export default async function PickTimePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; serviceId: string }>;
  searchParams: Promise<Search>;
}) {
  const [{ slug, serviceId }, search] = await Promise.all([params, searchParams]);
  const place = await resolvePlace(slug);
  if (!place) notFound();
  const context = await loadBookingContext(place.businessId, serviceId);
  if (!context) notFound();

  const t = await getTranslations("booking");
  const tCommon = await getTranslations("common");
  const { service, business, providers } = context;
  const solo = business.kind === "independent";
  const now = new Date();

  const atClientPlace =
    service.locationType === "client_place" ||
    (service.locationType === "both" && search.at === "client");
  // With one professional there is nothing to choose: the booking is with her.
  const chosen =
    providers.length === 1
      ? providers[0]!
      : (providers.find((provider) => provider.membershipId === search.with) ?? null);

  const today = localDateOf(now, business.timeZone);
  const lastDay = addDays(today, business.maxAdvanceDays);
  const start =
    search.start && isLocalDate(search.start) && search.start >= today && search.start <= lastDay
      ? search.start
      : today;
  const days = Array.from({ length: DAYS_SHOWN }, (_, index) => addDays(start, index)).filter(
    (day) => day <= lastDay,
  );
  const slotsByDay = await Promise.all(
    days.map((date) =>
      getOpenSlots(context, {
        date,
        membershipId: chosen?.membershipId ?? null,
        atClientPlace,
        now,
      }),
    ),
  );
  const firstOpen = days.find((_, index) => slotsByDay[index]!.length > 0);
  const selected = search.date && days.includes(search.date) ? search.date : (firstOpen ?? days[0]!);
  const slots = slotsByDay[days.indexOf(selected)] ?? [];

  const basePath = `${place.path}/book/${service.id}`;
  const href = (change: Partial<Search>) => {
    const next = { at: search.at, with: search.with, start, date: search.date, ...change };
    const query = new URLSearchParams();
    if (next.at === "client") query.set("at", "client");
    if (next.with) query.set("with", next.with);
    if (next.start && next.start !== today) query.set("start", next.start);
    if (next.date) query.set("date", next.date);
    const text = query.toString();
    return text ? `${basePath}?${text}` : basePath;
  };
  const here = href({ date: selected });
  const price = priceFor(context, atClientPlace);
  const notice = NOTICES.find((value) => value === search.notice);
  const selectedInstant = zonedTimeToUtc(selected, 720, business.timeZone);

  return (
    <>
      <div className="band" aria-hidden="true" />
      <main className="mx-auto w-full max-w-xl flex-1 space-y-6 px-5 pb-10">
        <header className="space-y-1.5 pt-6">
          <Link href={place.path} className="link text-sm">
            {t("backTo", { name: place.name })}
          </Link>
          <h1 className="title-lg">{service.name}</h1>
          <p className="text-muted">{formatDuration(service.durationMinutes, tCommon)}</p>
          {price !== null ? (
            <p className="font-bold tabular-nums">
              {formatMoney({ amount: price, currency: service.currency })}
            </p>
          ) : null}
        </header>

        {notice ? (
          <p className="rounded-md bg-warning-tint px-3 py-2 text-sm" role="status">
            {t(`notices.${notice}`)}
          </p>
        ) : null}

        {providers.length === 0 ? (
          <p className="border-y border-line py-5 text-muted">{t("notBookable")}</p>
        ) : (
          <>
            {service.locationType === "both" ? (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">{t("where")}</h2>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={href({ at: undefined, date: undefined })}
                    className="choice"
                    aria-current={atClientPlace ? undefined : "true"}
                  >
                    {solo ? t("atStudioSolo") : t("atStudio")}
                  </Link>
                  <Link
                    href={href({ at: "client", date: undefined })}
                    className="choice"
                    aria-current={atClientPlace ? "true" : undefined}
                  >
                    {t("atClientPlace")}
                  </Link>
                </div>
              </section>
            ) : null}

            {providers.length > 1 ? (
              <section className="space-y-2">
                <h2 className="text-sm font-semibold">{t("who")}</h2>
                <div className="flex flex-wrap gap-2">
                  <Link
                    href={href({ with: undefined, date: undefined })}
                    className="choice"
                    aria-current={chosen ? undefined : "true"}
                  >
                    {t("anyone")}
                  </Link>
                  {providers.map((provider) => (
                    <Link
                      key={provider.membershipId}
                      href={href({ with: provider.membershipId, date: undefined })}
                      className="choice"
                      aria-current={chosen?.membershipId === provider.membershipId ? "true" : undefined}
                    >
                      {provider.displayName}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}

            <section className="space-y-2">
              <h2 className="text-sm font-semibold">{t("day")}</h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {days.map((day, index) => {
                  const label = formatShortDay(day);
                  const open = slotsByDay[index]!.length > 0;
                  return (
                    <Link
                      key={day}
                      href={href({ date: day })}
                      className={`day-chip ${open ? "" : "day-chip-empty"}`}
                      aria-current={day === selected ? "true" : undefined}
                    >
                      <span className="text-xs">{label.weekday}</span>
                      <span className="font-semibold">{label.day}</span>
                    </Link>
                  );
                })}
              </div>
              <p className="flex justify-between text-sm">
                {start > today ? (
                  <Link
                    href={href({
                      start: addDays(start, -DAYS_SHOWN) < today ? today : addDays(start, -DAYS_SHOWN),
                      date: undefined,
                    })}
                    className="link"
                  >
                    {t("earlier")}
                  </Link>
                ) : (
                  <span />
                )}
                {addDays(start, DAYS_SHOWN) <= lastDay ? (
                  <Link href={href({ start: addDays(start, DAYS_SHOWN), date: undefined })} className="link">
                    {t("later")}
                  </Link>
                ) : null}
              </p>
            </section>

            <section className="space-y-3">
              <h2 className="title-sm">
                {t("timesFor", { date: formatDate(selectedInstant, business.timeZone) })}
              </h2>
              {slots.length === 0 ? (
                <p className="text-muted">{firstOpen ? t("noTimesDay") : t("noTimesAtAll")}</p>
              ) : (
                <form action={holdTimeAction} className="grid grid-cols-3 gap-2">
                  <input type="hidden" name="businessId" value={business.id} />
                  <input type="hidden" name="serviceId" value={service.id} />
                  <input type="hidden" name="with" value={chosen?.membershipId ?? ""} />
                  <input type="hidden" name="at" value={atClientPlace ? "client" : ""} />
                  <input type="hidden" name="source" value={place.source} />
                  <input type="hidden" name="back" value={here} />
                  {slots.map((slot) => (
                    <button
                      key={slot.startsAt.getTime()}
                      type="submit"
                      name="startsAt"
                      value={slot.startsAt.toISOString()}
                      className="btn btn-quiet px-1 tabular-nums"
                    >
                      {formatTime(slot.startsAt, business.timeZone)}
                    </button>
                  ))}
                </form>
              )}
            </section>
          </>
        )}
      </main>
    </>
  );
}
