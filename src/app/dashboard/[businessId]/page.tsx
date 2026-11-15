import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { listHats } from "@/modules/businesses/queries";
import { siteUrl } from "@/env";
import { currentScope } from "./current-scope";

async function Overview({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { user, scope } = await currentScope(businessId);
  const t = await getTranslations("dashboard");
  const tRoles = await getTranslations("roles");

  const hat = (await listHats(user.id)).find((h) => h.businessId === businessId);
  const bookingLink = hat?.publicPath ? siteUrl(hat.publicPath) : null;

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("welcome", { name: user.displayName })}
        </h1>
        <p className="text-sm text-neutral-600">
          {t("yourRole", { role: tRoles(scope.actor.role) })}
        </p>
      </div>

      <section className="space-y-2 rounded-md border border-neutral-200 p-4">
        <h2 className="font-medium">{t("bookingLink")}</h2>
        {bookingLink ? (
          <>
            <p className="break-all rounded bg-neutral-100 px-3 py-2 font-mono text-sm">
              {bookingLink}
            </p>
            <p className="text-sm text-neutral-600">{t("bookingLinkHint")}</p>
            <p className="flex gap-4 text-sm">
              <a href={bookingLink} className="underline">
                {t("viewPage")}
              </a>
              {scope.can("settings.manage") ? (
                <Link href={`/dashboard/${businessId}/page-settings`} className="underline">
                  {t("editPage")}
                </Link>
              ) : null}
            </p>
          </>
        ) : (
          <p className="text-sm text-neutral-600">{t("bookingLinkMissing")}</p>
        )}
      </section>
    </div>
  );
}

export default function BusinessDashboardPage({ params }: PageProps<"/dashboard/[businessId]">) {
  return (
    <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
      <Overview params={params} />
    </Suspense>
  );
}
