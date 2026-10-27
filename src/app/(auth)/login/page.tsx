import { getTranslations } from "next-intl/server";
import { LoginForm } from "./login-form";
import { googleEnabled, telegramEnabled } from "@/env";
import { env } from "@/env";

// Reads searchParams and env at request time (Cache Components).
export const instant = false;

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const t = await getTranslations("auth");
  const { error } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("loginTitle")}</h1>
        <p className="text-sm text-neutral-600">{t("loginSubtitle")}</p>
      </div>
      {error ? (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
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
