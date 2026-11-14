import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getIndependentPractice } from "@/modules/businesses/queries";
import { getProfessionalProfileByUserId } from "@/modules/identity/profiles";
import { getSessionUser } from "@/modules/identity/session";
import { IndependentForm } from "./independent-form";

export const instant = false;

async function IndependentBody() {
  const t = await getTranslations("onboarding");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const practice = await getIndependentPractice(user.id);
  if (practice) redirect(`/dashboard/${practice.id}`);
  const profile = await getProfessionalProfileByUserId(user.id);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("independentTitle")}
        </h1>
        <p className="text-sm text-neutral-600">{t("independentFormSubtitle")}</p>
      </div>
      <IndependentForm
        defaultName={profile?.displayName ?? user.displayName}
        existingHandle={profile?.handle ?? null}
      />
    </div>
  );
}

export default function IndependentOnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <IndependentBody />
      </Suspense>
    </main>
  );
}
