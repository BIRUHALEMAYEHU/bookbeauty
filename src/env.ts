import "server-only";
import { z } from "zod";
import { readHostConfig } from "@/lib/hosts";
import { cleanTelegramUsername } from "@/modules/identity/telegram";

/** A blank setting ("SITE_URL=") means "not set". */
const optionalUrl = z.preprocess((value) => (value === "" ? undefined : value), z.string().url().optional());

const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32),
  APP_URL: z.string().url().default("http://localhost:3000"),
  /** Main domain for public pages; defaults to APP_URL (D108). */
  SITE_URL: optionalUrl,
  /** Address of the admin area; defaults to APP_URL (D109). */
  ADMIN_URL: optionalUrl,
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_BOT_USERNAME: z.string().optional().transform(cleanTelegramUsername),
  /** Comma-separated emails that are platform administrators once verified. */
  PLATFORM_ADMIN_EMAILS: z.string().optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  TURNSTILE_SITE_KEY: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export const env = schema.parse(process.env);

/** The three addresses, without trailing slashes. See src/lib/hosts.ts. */
export const hosts = readHostConfig(env);

/** Full link to a public page, for example siteUrl("/@hana"). */
export const siteUrl = (path = "") => `${hosts.site}${path}`;
export const appUrl = (path = "") => `${hosts.app}${path}`;
export const adminUrl = (path = "") => `${hosts.admin}${path}`;

export function googleEnabled() {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function telegramEnabled() {
  return Boolean(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_BOT_USERNAME);
}
