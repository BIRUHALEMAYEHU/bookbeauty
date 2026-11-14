import "server-only";
import { emailText } from "@/i18n/translator";
import type { EmailMessage } from "@/integrations/email";

type LinkEmail = "verify" | "reset";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A short email with one link, worded from the "emails" section of en.json. */
export function linkEmail(
  kind: LinkEmail,
  to: { email: string; name: string },
  url: string,
): EmailMessage {
  const t = emailText();
  const greeting = t("greeting", { name: to.name });
  const lines = [t(`${kind}.body`), t(`${kind}.expiry`), t(`${kind}.notYou`)];
  const action = t(`${kind}.action`);
  const signature = t("signature");

  const text = [greeting, "", lines[0], "", `${action}: ${url}`, "", lines[1], lines[2], "", signature].join(
    "\n",
  );

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>${escapeHtml(lines[0]!)}</p>`,
    `<p><a href="${escapeHtml(url)}">${escapeHtml(action)}</a></p>`,
    `<p>${escapeHtml(lines[1]!)}<br>${escapeHtml(lines[2]!)}</p>`,
    `<p>${escapeHtml(signature)}</p>`,
  ].join("\n");

  return { to: to.email, subject: t(`${kind}.subject`), text, html };
}
