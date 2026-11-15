import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { listServiceProviderChoices } from "@/modules/catalog/services";
import { currentScope } from "../../current-scope";
import { serviceFormChoices } from "../form-choices";
import { ServiceForm } from "../service-form";

async function NewService({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { scope } = await currentScope(businessId);
  if (!scope.can("services.edit")) notFound();

  const t = await getTranslations("services");
  const [business, providers, choices] = await Promise.all([
    scope.business(),
    listServiceProviderChoices(scope),
    serviceFormChoices(),
  ]);

  return (
    <div className="max-w-xl space-y-6">
      <h1 className="title">{t("newTitle")}</h1>
      <ServiceForm
        businessId={businessId}
        serviceId={null}
        solo={business.kind === "independent"}
        values={{
          name: "",
          description: "",
          durationMinutes: 60,
          bufferMinutes: 0,
          locationType: "studio",
          priceStudio: "",
          priceClientPlace: "",
          // With one person to choose from, she is almost always the answer.
          providerMembershipIds: providers.length === 1 ? [providers[0]!.membershipId] : [],
        }}
        durations={choices.durations}
        buffers={choices.buffers}
        providers={providers.map(({ membershipId, displayName }) => ({ membershipId, displayName }))}
      />
    </div>
  );
}

export default function NewServicePage({
  params,
}: PageProps<"/dashboard/[businessId]/services/new">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <NewService params={params} />
    </Suspense>
  );
}
