import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { adminUrl } from "@/env";
import { listHats } from "@/modules/businesses/queries";
import { getSessionUser } from "@/modules/identity/session";
import { isPlatformAdmin } from "@/modules/platform/admins";

/**
 * Where login lands (D11): no places yet goes to onboarding (or the admin area
 * for a platform administrator), one place opens straight into it, several
 * show the choice.
 */
async function ChooseHat() {
  const t = await getTranslations("dashboard");
  const tRoles = await getTranslations("roles");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const hats = await listHats(user.id);
  if (hats.length === 0) {
    // A platform administrator runs the platform; she is not asked to set up a business.
    redirect((await isPlatformAdmin(user.id)) ? adminUrl("/admin") : "/onboarding");
  }
  if (hats.length === 1) redirect(`/dashboard/${hats[0]!.businessId}`);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("chooseTitle")}</h1>
        <p className="text-sm text-neutral-600">{t("chooseSubtitle")}</p>
      </div>
      <ul className="space-y-3">
        {hats.map((hat) => (
          <li key={hat.businessId}>
            <Link
              href={`/dashboard/${hat.businessId}`}
              className="block rounded-md border border-neutral-300 px-4 py-3 hover:border-neutral-500"
            >
              <span className="block font-medium">{hat.name}</span>
              <span className="mt-1 block text-sm text-neutral-600">
                {hat.kind === "independent" ? t("kindIndependent") : t("kindSalon")}
                {" · "}
                {tRoles(hat.role)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-center text-sm">
        <Link href="/onboarding" className="underline">
          {t("addHat")}
        </Link>
      </p>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <ChooseHat />
      </Suspense>
    </main>
  );
}
