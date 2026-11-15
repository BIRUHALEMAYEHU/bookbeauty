import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { archiveServiceAction, restoreServiceAction } from "@/modules/catalog/actions";
import { getService, listServiceProviderChoices } from "@/modules/catalog/services";
import { currentScope } from "../../current-scope";
import { serviceFormChoices } from "../form-choices";
import { ServiceForm } from "../service-form";

/** Santim as she would type it: "800" or "1250.50". */
function priceText(amount: number | null) {
  if (amount === null) return "";
  return amount % 100 === 0 ? String(amount / 100) : (amount / 100).toFixed(2);
}

async function EditService({
  params,
}: {
  params: Promise<{ businessId: string; serviceId: string }>;
}) {
  const { businessId, serviceId } = await params;
  const { scope } = await currentScope(businessId);
  if (!scope.can("services.edit")) notFound();

  const service = await getService(scope, serviceId);
  if (!service) notFound();

  const t = await getTranslations("services");
  const [business, providers, choices] = await Promise.all([
    scope.business(),
    listServiceProviderChoices(scope),
    serviceFormChoices(service),
  ]);
  const archived = service.status === "archived";

  return (
    <div className="max-w-xl space-y-8">
      <h1 className="title">{t("editTitle")}</h1>
      <ServiceForm
        businessId={businessId}
        serviceId={service.id}
        solo={business.kind === "independent"}
        values={{
          name: service.name,
          description: service.description ?? "",
          durationMinutes: service.durationMinutes,
          bufferMinutes: service.bufferMinutes,
          locationType: service.locationType,
          priceStudio: priceText(service.priceStudio),
          priceClientPlace: priceText(service.priceClientPlace),
          providerMembershipIds: service.providerMembershipIds,
        }}
        durations={choices.durations}
        buffers={choices.buffers}
        providers={providers.map(({ membershipId, displayName }) => ({ membershipId, displayName }))}
      />

      <section className="space-y-2 border-t border-line pt-5">
        <form
          action={(archived ? restoreServiceAction : archiveServiceAction).bind(
            null,
            businessId,
            service.id,
          )}
        >
          <button type="submit" className="btn btn-quiet btn-small">
            {archived ? t("restore") : t("archive")}
          </button>
        </form>
        <p className="text-sm text-muted">{archived ? t("archivedHint") : t("archiveHint")}</p>
      </section>
    </div>
  );
}

export default function EditServicePage({
  params,
}: PageProps<"/dashboard/[businessId]/services/[serviceId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <EditService params={params} />
    </Suspense>
  );
}
