import "server-only";
import { env } from "@/env";

export type EmailMessage = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

const outbox: EmailMessage[] = [];

/**
 * The only way the platform sends email (D105). Resend when configured;
 * otherwise the message is printed in development and kept in memory in tests.
 */
export async function sendEmail(message: EmailMessage): Promise<void> {
  if (env.RESEND_API_KEY) {
    await sendWithResend(message, env.RESEND_API_KEY);
    return;
  }

  if (env.NODE_ENV === "production") {
    throw new Error("RESEND_API_KEY is not set; cannot send email in production");
  }

  outbox.push(message);
  if (env.NODE_ENV === "development") {
    console.info(`\n[email] to ${message.to}: ${message.subject}\n${message.text}\n`);
  }
}

async function sendWithResend(message: EmailMessage, apiKey: string) {
  if (!env.EMAIL_FROM) throw new Error("EMAIL_FROM is not set");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.EMAIL_FROM,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  });

  if (!response.ok) {
    throw new Error(`Resend rejected the email (${response.status})`);
  }
}

/** Emails captured when no provider is configured. Tests read this. */
export function capturedEmails(): readonly EmailMessage[] {
  return outbox;
}
