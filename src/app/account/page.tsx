import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { logoutAction } from "@/modules/identity/actions";
import { getSessionUser } from "@/modules/identity/session";

export const instant = false;

async function AccountBody() {
  const t = await getTranslations("account");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-neutral-500">{t("displayName")}</dt>
          <dd>{user.displayName}</dd>
        </div>
        <div>
          <dt className="text-neutral-500">{t("email")}</dt>
          <dd>{user.email ?? t("noEmail")}</dd>
        </div>
      </dl>
      <form action={logoutAction}>
        <button
          type="submit"
          className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
        >
          {t("logout")}
        </button>
      </form>
    </div>
  );
}

export default function AccountPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <AccountBody />
      </Suspense>
    </main>
  );
}
