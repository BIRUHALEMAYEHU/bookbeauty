import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { listHats } from "@/modules/businesses/queries";
import { logoutAction } from "@/modules/identity/actions";
import { NavTabs } from "@/app/nav-tabs";
import { currentScope } from "./current-scope";

async function DashboardHeader({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { user, scope } = await currentScope(businessId);
  const t = await getTranslations("dashboard");
  const tRoles = await getTranslations("roles");
  const [business, hats] = await Promise.all([scope.business(), listHats(user.id)]);
  const others = hats.filter((hat) => hat.businessId !== businessId);

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="title-sm truncate">{business.name}</p>
          <p className="text-xs text-muted">{tRoles(scope.actor.role)}</p>
        </div>

        <nav className="flex items-center gap-4 text-sm">
          <details className="relative">
            <summary className="link cursor-pointer list-none">{t("switchHat")}</summary>
            <div className="absolute right-0 z-10 mt-2 w-64 space-y-1 rounded-md border border-line bg-white p-2">
              {others.map((hat) => (
                <Link
                  key={hat.businessId}
                  href={`/dashboard/${hat.businessId}`}
                  className="block rounded px-2 py-1.5 hover:bg-wash"
                >
                  <span className="block font-medium">{hat.name}</span>
                  <span className="block text-xs text-muted">
                    {hat.kind === "independent" ? t("kindIndependent") : t("kindSalon")}
                    {" · "}
                    {tRoles(hat.role)}
                  </span>
                </Link>
              ))}
              <Link
                href="/onboarding"
                className="block rounded px-2 py-1.5 text-muted hover:bg-wash"
              >
                {t("addHat")}
              </Link>
            </div>
          </details>
          <Link href="/account" className="link">
            {t("account")}
          </Link>
          <form action={logoutAction}>
            <button type="submit" className="link">
              {t("logout")}
            </button>
          </form>
        </nav>
      </div>
      <div className="mx-auto w-full max-w-3xl">
        <NavTabs
          items={[
            { href: `/dashboard/${businessId}`, label: t("nav.overview") },
            { href: `/dashboard/${businessId}/bookings`, label: t("nav.bookings") },
            ...(scope.can("customers.view")
              ? [{ href: `/dashboard/${businessId}/customers`, label: t("nav.customers") }]
              : []),
            ...(scope.can("revenue.view")
              ? [{ href: `/dashboard/${businessId}/income`, label: t("nav.income") }]
              : []),
            { href: `/dashboard/${businessId}/services`, label: t("nav.services") },
            { href: `/dashboard/${businessId}/hours`, label: t("nav.hours") },
            ...(scope.can("settings.manage")
              ? [{ href: `/dashboard/${businessId}/page-settings`, label: t("nav.page") }]
              : []),
            ...(scope.can("activity_log.view")
              ? [{ href: `/dashboard/${businessId}/activity`, label: t("nav.activity") }]
              : []),
          ]}
        />
      </div>
    </header>
  );
}

export default function BusinessDashboardLayout({
  children,
  params,
}: LayoutProps<"/dashboard/[businessId]">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-24 border-b border-line" />}>
        <DashboardHeader params={params} />
      </Suspense>
      <div className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</div>
    </div>
  );
}
