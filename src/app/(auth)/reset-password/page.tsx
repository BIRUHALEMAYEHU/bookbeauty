import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { isEmailTokenUsable } from "@/modules/identity/email-tokens";
import { ResetPasswordForm } from "./reset-password-form";

// Reads the token from the address at request time (Cache Components).
export const instant = false;

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const t = await getTranslations("auth");
  const { token = "" } = await searchParams;
  const usable = await isEmailTokenUsable(token, "reset_password");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("resetTitle")}</h1>
        {usable ? <p className="text-sm text-neutral-600">{t("resetSubtitle")}</p> : null}
      </div>
      {usable ? (
        <ResetPasswordForm token={token} />
      ) : (
        <div className="space-y-4">
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {t("errors.link_invalid")}
          </p>
          <p className="text-center text-sm">
            <Link href="/forgot-password" className="underline">
              {t("requestNewLink")}
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}
