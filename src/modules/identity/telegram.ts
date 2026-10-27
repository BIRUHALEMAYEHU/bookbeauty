import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { TelegramAuthPayload } from "./telegram-types";

export type { TelegramAuthPayload };

const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

/**
 * Verifies a Telegram Login Widget payload.
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyTelegramLogin(
  payload: TelegramAuthPayload,
  botToken: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (nowSeconds - payload.auth_date > MAX_AUTH_AGE_SECONDS) {
    return false;
  }

  const checkString = Object.entries(payload)
    .filter(([key]) => key !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(checkString).digest("hex");

  try {
    return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(payload.hash, "hex"));
  } catch {
    return false;
  }
}

export function displayNameFromTelegram(payload: TelegramAuthPayload) {
  const full = [payload.first_name, payload.last_name].filter(Boolean).join(" ").trim();
  return full || payload.username || `Telegram ${payload.id}`;
}
