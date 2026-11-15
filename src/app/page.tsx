import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { appUrl } from "@/env";
import { getSessionUser } from "@/modules/identity/session";

async function HomeAuthLinks() {
  const t = await getTranslations("home");
  const user = await getSessionUser();

  if (user) {
    return (
      <a href={appUrl("/dashboard")} className="btn btn-primary">
        {t("dashboard")}
      </a>
    );
  }

  return (
    <div className="flex flex-wrap gap-3">
      <a href={appUrl("/signup")} className="btn btn-primary">
        {t("signup")}
      </a>
      <a href={appUrl("/login")} className="btn btn-quiet">
        {t("login")}
      </a>
    </div>
  );
}

export default async function HomePage() {
  const t = await getTranslations("home");

  return (
    <>
      <div className="band" aria-hidden="true" />
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 px-5 py-10">
        <h1 className="title-lg text-5xl">{t("title")}</h1>
        <p className="title-sm max-w-[28ch] text-2xl">{t("tagline")}</p>
        <p className="text-sm text-muted">{t("comingSoon")}</p>
        {/* Reserve the buttons' height so the page does not jump when they arrive. */}
        <div className="min-h-12">
          <Suspense fallback={null}>
            <HomeAuthLinks />
          </Suspense>
        </div>
      </main>
    </>
  );
}
