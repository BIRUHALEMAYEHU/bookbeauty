import { getTranslations } from "next-intl/server";
import { SignupForm } from "./signup-form";
import { googleEnabled, telegramEnabled } from "@/env";
import { env } from "@/env";

export const instant = false;

export default async function SignupPage() {
  const t = await getTranslations("auth");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("signupTitle")}</h1>
        <p className="text-sm text-neutral-600">{t("signupSubtitle")}</p>
      </div>
      <SignupForm
        googleEnabled={googleEnabled()}
        telegramBotUsername={telegramEnabled() ? env.TELEGRAM_BOT_USERNAME! : null}
      />
    </main>
  );
}
