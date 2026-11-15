import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { listHats } from "@/modules/businesses/queries";
import { logoutAction } from "@/modules/identity/actions";
import { currentScope } from "./current-scope";

async function DashboardHeader({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { user, scope } = await currentScope(businessId);
  const t = await getTranslations("dashboard");
  const tRoles = await getTranslations("roles");
  const [business, hats] = await Promise.all([scope.business(), listHats(user.id)]);
  const others = hats.filter((hat) => hat.businessId !== businessId);

  return (
    <header className="border-b border-neutral-200">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{business.name}</p>
          <p className="text-xs text-neutral-500">{tRoles(scope.actor.role)}</p>
        </div>

        <nav className="flex items-center gap-4 text-sm">
          <details className="relative">
            <summary className="cursor-pointer list-none underline">{t("switchHat")}</summary>
            <div className="absolute right-0 z-10 mt-2 w-64 space-y-1 rounded-md border border-neutral-200 bg-white p-2 shadow-sm">
              {others.map((hat) => (
                <Link
                  key={hat.businessId}
                  href={`/dashboard/${hat.businessId}`}
                  className="block rounded px-2 py-1.5 hover:bg-neutral-100"
                >
                  <span className="block font-medium">{hat.name}</span>
                  <span className="block text-xs text-neutral-500">
                    {hat.kind === "independent" ? t("kindIndependent") : t("kindSalon")}
                    {" · "}
                    {tRoles(hat.role)}
                  </span>
                </Link>
              ))}
              <Link
                href="/onboarding"
                className="block rounded px-2 py-1.5 text-neutral-700 hover:bg-neutral-100"
              >
                {t("addHat")}
              </Link>
            </div>
          </details>
          <Link href="/account" className="underline">
            {t("account")}
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="underline">
              {t("logout")}
            </button>
          </form>
        </nav>
      </div>
      <nav className="mx-auto flex w-full max-w-3xl gap-4 px-4 pb-2 text-sm">
        <Link href={`/dashboard/${businessId}`} className="underline">
          {t("nav.overview")}
        </Link>
        {scope.can("settings.manage") ? (
          <Link href={`/dashboard/${businessId}/page-settings`} className="underline">
            {t("nav.page")}
          </Link>
        ) : null}
        {scope.can("activity_log.view") ? (
          <Link href={`/dashboard/${businessId}/activity`} className="underline">
            {t("nav.activity")}
          </Link>
        ) : null}
      </nav>
    </header>
  );
}

export default function BusinessDashboardLayout({
  children,
  params,
}: LayoutProps<"/dashboard/[businessId]">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-14 border-b border-neutral-200" />}>
        <DashboardHeader params={params} />
      </Suspense>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
