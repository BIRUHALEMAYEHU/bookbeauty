import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { listMembershipsForUser } from "@/modules/businesses/queries";
import { logoutAction, resendVerificationAction } from "@/modules/identity/actions";
import { getSessionUser } from "@/modules/identity/session";

export const instant = false;

const NOTICES = [
  "email_verified",
  "verification_sent",
  "verification_rate_limited",
  "link_invalid",
  "password_reset",
] as const;
type Notice = (typeof NOTICES)[number];

function asNotice(value: string | undefined): Notice | null {
  return NOTICES.find((notice) => notice === value) ?? null;
}

async function AccountBody({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const t = await getTranslations("account");
  const tRoles = await getTranslations("roles");
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const memberships = await listMembershipsForUser(user.id);
  const notice = asNotice((await searchParams).notice);
  const needsVerification = Boolean(user.email && !user.emailVerifiedAt);

  return (
    <div className="space-y-6">
      {notice ? (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            notice === "link_invalid" || notice === "verification_rate_limited"
              ? "bg-red-50 text-red-700"
              : "bg-green-50 text-green-800"
          }`}
          role="status"
        >
          {t(`notices.${notice}`)}
        </p>
      ) : null}
      {needsVerification ? (
        <section className="space-y-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm">
          <h2 className="font-medium">{t("verifyEmailTitle")}</h2>
          <p className="text-neutral-700">{t("verifyEmailBody", { email: user.email! })}</p>
          <form action={resendVerificationAction}>
            <button type="submit" className="underline">
              {t("verifyEmailResend")}
            </button>
          </form>
        </section>
      ) : null}
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
                className="flex items-center justify-between gap-3 rounded-md border border-neutral-200 px-3 py-2"
              >
                <div>
                  <p className="font-medium">{business.name}</p>
                <p className="text-neutral-600">
                  {business.kind === "independent"
                    ? t("kindIndependent")
                    : t("kindSalon")}
                  {" · "}
                  {t("role")}: {tRoles(membership.role)}
                </p>
                </div>
                <Link href={`/dashboard/${business.id}`} className="underline">
                  {t("openDashboard")}
                </Link>
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

export default function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center p-6">
      <Suspense fallback={<p className="text-sm text-neutral-500">…</p>}>
        <AccountBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
