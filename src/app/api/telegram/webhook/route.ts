import { timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { handleTelegramUpdate, type TelegramUpdate } from "@/modules/messaging/telegram";

/**
 * Where Telegram delivers the bot's updates. Only requests carrying the
 * secret we gave Telegram are accepted (TELEGRAM_WEBHOOK_SECRET).
 */
function hasSecret(request: Request) {
  const expected = env.TELEGRAM_WEBHOOK_SECRET;
  const given = request.headers.get("x-telegram-bot-api-secret-token");
  if (!expected || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!hasSecret(request)) return new Response(null, { status: 401 });

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return new Response(null, { status: 400 });
  }

  try {
    await handleTelegramUpdate(update);
  } catch (error) {
    // Answer 200 anyway: Telegram would otherwise resend the same update again and again.
    console.error("[telegram] update failed", error);
  }
  return new Response(null, { status: 200 });
}
