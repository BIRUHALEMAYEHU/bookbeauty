import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getIndependentPractice, listHats } from "@/modules/businesses/queries";
import { getSessionUser } from "@/modules/identity/session";

export const instant = false;

async function OnboardingBody() {
  const t = await getTranslations("onboarding");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [hats, practice] = await Promise.all([
    listHats(user.id),
    getIndependentPractice(user.id),
  ]);
  const adding = hats.length > 0;

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="title">
          {adding ? t("addAnotherTitle") : t("title")}
        </h1>
        <p className="text-sm text-muted">
          {adding ? t("addAnotherSubtitle") : t("subtitle")}
        </p>
      </div>

      <ul className="space-y-3">
        <li>
          {practice ? (
            <div className="rounded-md border border-line px-4 py-3 text-muted">
              <span className="block font-medium">{t("independentTitle")}</span>
              <span className="mt-1 block text-sm">
                {t("independentExists")}{" "}
                <Link href={`/dashboard/${practice.id}`} className="link">
                  {t("independentOpen")}
                </Link>
              </span>
            </div>
          ) : (
            <Link
              href="/onboarding/independent"
              className="block rounded-md border border-line-strong px-4 py-3 hover:border-ink"
            >
              <span className="block font-medium">{t("independentTitle")}</span>
              <span className="mt-1 block text-sm text-muted">
                {t("independentBody")}
              </span>
            </Link>
          )}
        </li>
        <li>
          <Link
            href="/onboarding/salon"
            className="block rounded-md border border-line-strong px-4 py-3 hover:border-ink"
          >
            <span className="block font-medium">{t("salonTitle")}</span>
            <span className="mt-1 block text-sm text-muted">
              {t("salonBody")}
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/onboarding/employee"
            className="block rounded-md border border-line-strong px-4 py-3 hover:border-ink"
          >
            <span className="block font-medium">{t("employeeTitle")}</span>
            <span className="mt-1 block text-sm text-muted">
              {t("employeeBody")}
            </span>
          </Link>
        </li>
      </ul>

      {adding ? (
        <p className="text-center text-sm">
          <Link href="/dashboard" className="link">
            {t("backToDashboard")}
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-muted">…</p>}>
        <OnboardingBody />
      </Suspense>
    </main>
  );
}
