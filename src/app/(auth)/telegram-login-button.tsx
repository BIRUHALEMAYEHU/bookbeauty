"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { telegramLoginAction } from "@/modules/identity/actions";
import type { TelegramAuthPayload } from "@/modules/identity/telegram-types";

declare global {
  interface Window {
    onTelegramAuth?: (user: TelegramAuthPayload) => void;
  }
}

export function TelegramLoginButton({ botUsername }: { botUsername: string }) {
  const t = useTranslations("auth");
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => {
    window.onTelegramAuth = (user) => {
      startTransition(async () => {
        const result = await telegramLoginAction(user);
        if (result.error) setError(result.error);
      });
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "8");
    script.setAttribute("data-onauth", "onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    containerRef.current?.replaceChildren(script);

    return () => {
      delete window.onTelegramAuth;
    };
  }, [botUsername]);

  return (
    <div className="flex flex-col items-center gap-2">
      <div ref={containerRef} />
      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {t(`errors.${error}` as "errors.invalid_payload")}
        </p>
      ) : null}
    </div>
  );
}
