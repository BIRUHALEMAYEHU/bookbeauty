import { getTranslations } from "next-intl/server";
import { turnstileSiteKey } from "@/modules/abuse/turnstile";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const t = await getTranslations("auth");

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-6 p-6">
      <div className="space-y-1">
        <h1 className="title">{t("forgotTitle")}</h1>
        <p className="text-sm text-muted">{t("forgotSubtitle")}</p>
      </div>
      <ForgotPasswordForm botCheckSiteKey={turnstileSiteKey()} />
    </main>
  );
}
