import { Suspense } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { siteUrl } from "@/env";
import { getBusinessPageSettings } from "@/modules/businesses/page-settings";
import { listHats } from "@/modules/businesses/queries";
import { currentScope } from "../current-scope";
import { PageSettingsForm } from "./page-settings-form";

async function Settings({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { user, scope } = await currentScope(businessId);
  if (!scope.can("settings.manage")) notFound();

  const t = await getTranslations("pageSettings");
  const [values, hats] = await Promise.all([getBusinessPageSettings(scope), listHats(user.id)]);
  const publicPath = hats.find((hat) => hat.businessId === businessId)?.publicPath ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="space-y-1">
          <h1 className="title">{t("title")}</h1>
          <p className="text-sm text-muted">{t("subtitle")}</p>
        </div>
        {publicPath ? (
          <a href={siteUrl(publicPath)} className="link text-sm">
            {t("view")}
          </a>
        ) : null}
      </div>
      <PageSettingsForm businessId={businessId} values={values} />
    </div>
  );
}

export default function PageSettingsPage({
  params,
}: PageProps<"/dashboard/[businessId]/page-settings">) {
  return (
    <Suspense fallback={<p className="text-sm text-muted">…</p>}>
      <Settings params={params} />
    </Suspense>
  );
}
