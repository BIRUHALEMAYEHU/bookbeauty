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
}
