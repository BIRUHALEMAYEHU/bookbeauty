import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/modules/identity/session";
import { SignupForm } from "./signup-form";
import { googleEnabled, telegramEnabled } from "@/env";
import { env } from "@/env";
import { turnstileSiteKey } from "@/modules/abuse/turnstile";

export const instant = false;

export default async function SignupPage() {
  // Someone already logged in has no use for this page.
  if (await getSessionUser()) redirect("/dashboard");
  const t = await getTranslations("auth");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="title">{t("signupTitle")}</h1>
        <p className="text-sm text-muted">{t("signupSubtitle")}</p>
      </div>
      <SignupForm
        googleEnabled={googleEnabled()}
        telegramBotUsername={telegramEnabled() ? env.TELEGRAM_BOT_USERNAME! : null}
        botCheckSiteKey={turnstileSiteKey()}
      />
    </main>
  );
}
