import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/modules/identity/session";

export const instant = false;

async function EmployeeBody() {
  const t = await getTranslations("onboarding");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("employeeTitle")}
        </h1>
        <p className="text-sm text-neutral-600">{t("employeeWaiting")}</p>
      </div>
      <p className="text-sm text-neutral-600">{t("employeeWaitingHint")}</p>
      <p className="text-center text-sm">
        <Link href="/onboarding" className="underline">
          {t("back")}
        </Link>
      </p>
    </div>
  );
}

export default function EmployeeOnboardingPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <EmployeeBody />
      </Suspense>
    </main>
  );
}
