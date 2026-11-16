/**
 * Runs once when the server starts (Next.js instrumentation). Starts the
 * background jobs in the Node.js runtime only. Set JOBS_ENABLED=false to run
 * a server without them.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.JOBS_ENABLED !== "false") {
    const { startJobs } = await import("@/modules/messaging/jobs");
    await startJobs();
  }
  // Only the live server tells Telegram its address; a developer's machine would take the bot away from it.
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production") {
    const { registerTelegramWebhook } = await import("@/modules/messaging/telegram");
    await registerTelegramWebhook().catch((error: unknown) =>
      console.error("[telegram] could not set the webhook", error),
    );
  }
}
