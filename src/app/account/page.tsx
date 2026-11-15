import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { adminUrl } from "@/env";
import { listMembershipsForUser } from "@/modules/businesses/queries";
import { logoutAction, resendVerificationAction } from "@/modules/identity/actions";
import { getSessionUser } from "@/modules/identity/session";
import { isPlatformAdmin } from "@/modules/platform/admins";

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
  const admin = await isPlatformAdmin(user.id);
  const notice = asNotice((await searchParams).notice);
  const needsVerification = Boolean(user.email && !user.emailVerifiedAt);

  return (
    <div className="space-y-6">
      {notice ? (
        <p
          className={`rounded-md px-3 py-2 text-sm ${
            notice === "link_invalid" || notice === "verification_rate_limited"
              ? "bg-danger-tint text-danger"
              : "bg-primary-tint text-primary-dark"
          }`}
          role="status"
        >
          {t(`notices.${notice}`)}
        </p>
      ) : null}
      {needsVerification ? (
        <section className="space-y-2 rounded-md border border-thread-gold bg-warning-tint px-3 py-3 text-sm">
          <h2 className="font-medium">{t("verifyEmailTitle")}</h2>
          <p className="text-muted">{t("verifyEmailBody", { email: user.email! })}</p>
          <form action={resendVerificationAction}>
            <button type="submit" className="link">
              {t("verifyEmailResend")}
            </button>
          </form>
        </section>
      ) : null}
      <div className="space-y-4">
        <h1 className="title">{t("title")}</h1>
        <dl className="space-y-2 text-sm">
          <div>
            <dt className="text-muted">{t("displayName")}</dt>
            <dd>{user.displayName}</dd>
          </div>
          <div>
            <dt className="text-muted">{t("email")}</dt>
            <dd>{user.email ?? t("noEmail")}</dd>
          </div>
        </dl>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium text-muted">{t("businesses")}</h2>
        {memberships.length === 0 ? (
          <div className="space-y-3">
            <p className="text-sm text-muted">{t("noBusinesses")}</p>
            <Link
              href="/onboarding"
              className="btn btn-primary"
            >
              {t("startOnboarding")}
            </Link>
          </div>
        ) : (
          <ul className="space-y-2 text-sm">
            {memberships.map(({ membership, business }) => (
              <li
                key={membership.id}
                className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
              >
                <div>
                  <p className="font-medium">{business.name}</p>
                <p className="text-muted">
                  {business.kind === "independent"
                    ? t("kindIndependent")
                    : t("kindSalon")}
                  {" · "}
                  {t("role")}: {tRoles(membership.role)}
                </p>
                </div>
                <Link href={`/dashboard/${business.id}`} className="link">
                  {t("openDashboard")}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {admin ? (
        <p className="text-sm">
          <a href={adminUrl("/admin")} className="link">
            {t("adminLink")}
          </a>
        </p>
      ) : null}

      <form action={logoutAction}>
        <button
          type="submit"
          className="btn btn-quiet btn-small"
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
      <Suspense fallback={<p className="text-sm text-muted">…</p>}>
        <AccountBody searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
