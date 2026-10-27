import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { listMembershipsForUser } from "@/modules/businesses/queries";
import { getSessionUser } from "@/modules/identity/session";
import { SalonForm } from "./salon-form";

export const instant = false;

async function SalonBody() {
  const t = await getTranslations("onboarding");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const memberships = await listMembershipsForUser(user.id);
  if (memberships.length > 0) redirect("/account");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">{t("salonTitle")}</h1>
        <p className="text-sm text-neutral-600">{t("salonFormSubtitle")}</p>
      </div>
      <SalonForm />
    </div>
  );
}

export default function SalonOnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <SalonBody />
      </Suspense>
    </main>
  );
}
