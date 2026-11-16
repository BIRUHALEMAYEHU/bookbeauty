import "server-only";
import { env } from "@/env";

/**
 * The only way the platform talks to the Telegram Bot API (technical-plan
 * Section 1: called directly, no library). Without a bot token, messages are
 * kept in memory (tests) or printed (development), like email.
 */

export type TelegramSendResult =
  | { ok: true; messageId: string }
  /** blocked: she blocked the bot or never started it; trying again will not help. */
  | { ok: false; blocked: boolean; error: string };

const outbox: { chatId: string; text: string }[] = [];

async function call(method: string, body: object) {
  const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: { message_id?: number };
    description?: string;
    error_code?: number;
  };
  return { status: response.status, data };
}

/** Sends plain text to a chat. */
export async function sendTelegramMessage(chatId: string, text: string): Promise<TelegramSendResult> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    if (env.NODE_ENV === "production") throw new Error("TELEGRAM_BOT_TOKEN is not set");
    outbox.push({ chatId, text });
    if (env.NODE_ENV === "development") console.info(`\n[telegram] to ${chatId}:\n${text}\n`);
    return { ok: true, messageId: String(outbox.length) };
  }

  const { status, data } = await call("sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
  if (data.ok) return { ok: true, messageId: String(data.result?.message_id ?? "") };
  // 403: blocked by the user, or she never started the bot.
  return { ok: false, blocked: status === 403, error: `Telegram ${status}: ${data.description ?? "error"}` };
}

/**
 * Tells Telegram where to deliver updates for the bot, with a secret it sends
 * back on every update. Safe to repeat; run when the server starts.
 */
export async function setTelegramWebhook(url: string, secret: string) {
  const { data } = await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "my_chat_member"],
  });
  if (!data.ok) throw new Error(`Telegram setWebhook failed: ${data.description ?? "error"}`);
}

/** Messages kept when no bot is configured. Tests read this. */
export function capturedTelegramMessages(): readonly { chatId: string; text: string }[] {
  return outbox;
}
