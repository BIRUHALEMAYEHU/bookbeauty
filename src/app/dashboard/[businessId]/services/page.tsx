import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { formatDuration } from "@/lib/duration";
import { formatMoney } from "@/lib/money";
import { moveServiceAction, restoreServiceAction } from "@/modules/catalog/actions";
import { listServices, type ServiceWithProviders } from "@/modules/catalog/services";
import { currentScope } from "../current-scope";

async function Services({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { scope } = await currentScope(businessId);
  const t = await getTranslations("services");
  const tCommon = await getTranslations("common");

  const [all, members, business] = await Promise.all([
    listServices(scope, { includeArchived: true }),
    scope.members(),
    scope.business(),
  ]);
  const active = all.filter((service) => service.status === "active");
  const archived = all.filter((service) => service.status === "archived");
  const canEdit = scope.can("services.edit");
  const solo = business.kind === "independent";
  const names = new Map(members.map((member) => [member.membershipId, member.displayName]));

  const prices = (service: ServiceWithProviders) =>
    [
      service.priceStudio === null
        ? null
        : service.locationType === "both"
          ? t("atStudio", {
              price: formatMoney({ amount: service.priceStudio, currency: service.currency }),
            })
          : formatMoney({ amount: service.priceStudio, currency: service.currency }),
      service.priceClientPlace === null
        ? null
        : t("atClientPlace", {
            price: formatMoney({ amount: service.priceClientPlace, currency: service.currency }),
          }),
    ].filter((line): line is string => line !== null);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="space-y-1">
          <h1 className="title">{t("title")}</h1>
          <p className="text-sm text-muted">{t("subtitle")}</p>
        </div>
        {canEdit ? (
          <Link href={`/dashboard/${businessId}/services/new`} className="btn btn-primary">
            {t("add")}
          </Link>
        ) : null}
      </div>

      {active.length === 0 ? (
        <p className="border-y border-line py-6 text-muted">{t("empty")}</p>
      ) : (
        <ol className="divide-y divide-line border-y border-line">
          {active.map((service, index) => {
            const doneBy = service.providerMembershipIds
              .map((id) => names.get(id))
              .filter((name): name is string => Boolean(name));
            return (
              <li key={service.id} className="flex items-start gap-3 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="font-semibold">{service.name}</p>
                  <p className="text-sm text-muted">
                    {formatDuration(service.durationMinutes, tCommon)}
                    {service.bufferMinutes > 0
                      ? `, ${t("bufferAfter", { duration: formatDuration(service.bufferMinutes, tCommon) })}`
                      : ""}
                  </p>
                  {prices(service).map((line) => (
                    <p key={line} className="text-sm font-semibold tabular-nums">
                      {line}
                    </p>
                  ))}
                  {solo ? null : doneBy.length > 0 ? (
                    <p className="text-sm text-muted">
                      {t("performedBy", { names: doneBy.join(", ") })}
                    </p>
                  ) : (
                    <p className="text-sm text-danger">{t("noProviders")}</p>
                  )}
                </div>
                {canEdit ? (
                  <div className="flex flex-none items-center gap-2">
                    <form action={moveServiceAction.bind(null, businessId, service.id, "up")}>
                      <button
                        type="submit"
                        disabled={index === 0}
                        aria-label={t("moveUp", { name: service.name })}
                        className="btn btn-quiet btn-small px-3"
                      >
                        ↑
                      </button>
                    </form>
                    <form action={moveServiceAction.bind(null, businessId, service.id, "down")}>
                      <button
                        type="submit"
                        disabled={index === active.length - 1}
                        aria-label={t("moveDown", { name: service.name })}
                        className="btn btn-quiet btn-small px-3"
                      >
                        ↓
                      </button>
                    </form>
                    <Link
                      href={`/dashboard/${businessId}/services/${service.id}`}
                      className="btn btn-quiet btn-small"
                    >
                      {t("edit")}
                    </Link>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {archived.length > 0 ? (
        <details className="space-y-3">
          <summary className="link cursor-pointer text-sm">
            {t("archivedTitle", { count: archived.length })}
          </summary>
          <p className="text-sm text-muted">{t("archivedHint")}</p>
          <ul className="divide-y divide-line border-y border-line">
            {archived.map((service) => (
              <li key={service.id} className="flex items-center justify-between gap-3 py-3">
                <span className="min-w-0 truncate text-muted">{service.name}</span>
                {canEdit ? (
                  <form action={restoreServiceAction.bind(null, businessId, service.id)}>
                    <button type="submit" className="btn btn-quiet btn-small">
                      {t("restore")}
                    </button>
                  </form>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

export default function ServicesPage({ params }: PageProps<"/dashboard/[businessId]/services">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Services params={params} />
    </Suspense>
  );
}
