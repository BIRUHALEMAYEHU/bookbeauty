import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { listMembershipsForUser } from "@/modules/businesses/queries";
import { logoutAction } from "@/modules/identity/actions";
import { getSessionUser } from "@/modules/identity/session";

export const instant = false;

async function AccountBody() {
  const t = await getTranslations("account");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const memberships = await listMembershipsForUser(user.id);

  return (
    <div className="space-y-6">
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
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-neutral-500">{t("businesses")}</h2>
        {memberships.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-neutral-600">{t("noBusinesses")}</p>
            <Link
              href="/onboarding"
              className="inline-block rounded-md bg-neutral-900 px-3 py-2 text-sm text-white"
            >
              {t("startOnboarding")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {memberships.map(({ membership, business }) => (
              <li
                key={membership.id}
                className="rounded-md border border-neutral-200 px-3 py-2"
              >
                <p className="font-medium">{business.name}</p>
                <p className="text-neutral-600">
                  {business.kind === "independent"
                    ? t("kindIndependent")
                    : t("kindSalon")}
                  {" · "}
                  {t("role")}: {membership.role}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

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
