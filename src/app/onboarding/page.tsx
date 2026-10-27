import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { listMembershipsForUser } from "@/modules/businesses/queries";
import { getSessionUser } from "@/modules/identity/session";

export const instant = false;

async function OnboardingBody() {
  const t = await getTranslations("onboarding");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const memberships = await listMembershipsForUser(user.id);
  if (memberships.length > 0) redirect("/account");

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-neutral-600">{t("subtitle")}</p>
      </div>

      <ul className="space-y-3">
        <li>
          <Link
            href="/onboarding/independent"
            className="block rounded-md border border-neutral-300 px-4 py-3 hover:border-neutral-500"
          >
            <span className="block font-medium">{t("independentTitle")}</span>
            <span className="mt-1 block text-sm text-neutral-600">
              {t("independentBody")}
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/onboarding/salon"
            className="block rounded-md border border-neutral-300 px-4 py-3 hover:border-neutral-500"
          >
            <span className="block font-medium">{t("salonTitle")}</span>
            <span className="mt-1 block text-sm text-neutral-600">
              {t("salonBody")}
            </span>
          </Link>
        </li>
        <li>
          <Link
            href="/onboarding/employee"
            className="block rounded-md border border-neutral-300 px-4 py-3 hover:border-neutral-500"
          >
            <span className="block font-medium">{t("employeeTitle")}</span>
            <span className="mt-1 block text-sm text-neutral-600">
              {t("employeeBody")}
            </span>
          </Link>
        </li>
      </ul>
    </div>
  );
}

export default function OnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <OnboardingBody />
      </Suspense>
    </main>
  );
}
