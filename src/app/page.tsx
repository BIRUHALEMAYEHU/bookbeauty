import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { appUrl } from "@/env";
import { getSessionUser } from "@/modules/identity/session";

async function HomeAuthLinks() {
  const t = await getTranslations("home");
  const user = await getSessionUser();

  if (user) {
    return (
      <a href={appUrl("/dashboard")} className="text-sm underline">
        {t("dashboard")}
      </a>
    );
  }

  return (
    <div className="flex gap-4 text-sm">
      <a href={appUrl("/login")} className="underline">
        {t("login")}
      </a>
      <a href={appUrl("/signup")} className="underline">
        {t("signup")}
      </a>
    </div>
  );
}

export default async function HomePage() {
  const t = await getTranslations("home");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-lg text-neutral-600">{t("tagline")}</p>
      <p className="text-sm text-neutral-400">{t("comingSoon")}</p>
      <Suspense fallback={null}>
        <HomeAuthLinks />
      </Suspense>
    </main>
  );
}
