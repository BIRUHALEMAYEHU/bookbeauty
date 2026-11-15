import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { appUrl } from "@/env";
import { requireAdmin } from "./require-admin";

async function AdminHeader() {
  await requireAdmin();
  const t = await getTranslations("admin");
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3">
        <p className="title-sm">{t("title")}</p>
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/admin" className="link">
            {t("nav.overview")}
          </Link>
          <Link href="/admin/businesses" className="link">
            {t("nav.businesses")}
          </Link>
          <Link href="/admin/users" className="link">
            {t("nav.users")}
          </Link>
          <a href={appUrl("/account")} className="link">
            {t("nav.exit")}
          </a>
        </nav>
      </div>
    </header>
  );
}

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex flex-1 flex-col">
      <Suspense fallback={<div className="h-12 border-b border-line" />}>
        <AdminHeader />
      </Suspense>
      <div className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">
        <Suspense fallback={<p className="text-sm text-muted">…</p>}>{children}</Suspense>
      </div>
    </div>
  );
}
