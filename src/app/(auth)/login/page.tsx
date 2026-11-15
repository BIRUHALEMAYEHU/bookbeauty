import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/modules/identity/session";
import { LoginForm } from "./login-form";
import { googleEnabled, telegramEnabled } from "@/env";
import { env } from "@/env";

// Reads searchParams and env at request time (Cache Components).
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; notice?: string }>;
}) {
  // Someone already logged in has no use for this page.
  if (await getSessionUser()) redirect("/dashboard");
  const t = await getTranslations("auth");
  const { error, notice } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="title">{t("loginTitle")}</h1>
        <p className="text-sm text-muted">{t("loginSubtitle")}</p>
      </div>
      {notice === "email_verified" ? (
        <p className="rounded-md bg-primary-tint px-3 py-2 text-sm text-primary-dark" role="status">
          {t("notices.email_verified")}
        </p>
      ) : null}
      {error ? (
        <p className="rounded-md bg-danger-tint px-3 py-2 text-sm text-danger" role="alert">
          {t(`errors.${error}` as "errors.oauth_failed")}
        </p>
      ) : null}
      <LoginForm
        googleEnabled={googleEnabled()}
        telegramBotUsername={telegramEnabled() ? env.TELEGRAM_BOT_USERNAME! : null}
      />
    </main>
  );
}
