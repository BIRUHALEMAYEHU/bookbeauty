import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { formatDuration } from "@/lib/duration";
import { formatMoney } from "@/lib/money";
import type { PublicService } from "@/modules/public/pages";

/** What can be booked, with its length and price, before the customer commits to anything (Section 8.2). */
export async function ServiceList({
  services,
  bookPath,
}: {
  services: PublicService[];
  /** Where booking starts for this place, for example "/beauty-lounge/book". */
  bookPath: string;
}) {
  const t = await getTranslations("public");
  const tCommon = await getTranslations("common");

  return (
    <ul className="divide-y divide-line">
      {services.map((service) => {
        const money = (amount: number) => formatMoney({ amount, currency: service.currency });
        return (
          <li key={service.id} className="flex items-start justify-between gap-4 py-3">
            <div className="min-w-0 space-y-0.5">
              <p className="font-semibold">{service.name}</p>
              <p className="text-sm text-muted">
                {formatDuration(service.durationMinutes, tCommon)}
              </p>
              {service.description ? (
                <p className="whitespace-pre-line text-sm text-muted">{service.description}</p>
              ) : null}
            </div>
            <div className="flex flex-none flex-col items-end gap-1 text-right">
              {service.priceStudio !== null ? (
                <p className="font-bold tabular-nums">{money(service.priceStudio)}</p>
              ) : null}
              {service.priceClientPlace !== null ? (
                service.priceStudio === null ? (
                  <>
                    <p className="font-bold tabular-nums">{money(service.priceClientPlace)}</p>
                    <p className="text-sm text-muted">{t("homeVisitOnly")}</p>
                  </>
                ) : (
                  <p className="text-sm text-muted tabular-nums">
                    {t("homeVisitAlso", { price: money(service.priceClientPlace) })}
                  </p>
                )
              ) : null}
              <Link href={`${bookPath}/${service.id}`} className="btn btn-primary btn-small mt-1">
                {t("book")}
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
