import "server-only";
import { PgBoss } from "pg-boss";
import { env } from "@/env";
import { deliverDueMessages } from "./deliver";
import { onMessageQueued } from "./queue";

/**
 * Background jobs (technical-plan Section 9) run by pg-boss inside the web
 * server, so there is no second service to run (D81, D97). It keeps its own
 * tables in the "pgboss" schema of the same database.
 *
 * Note: on Render's free plan the server sleeps when idle, so jobs only run
 * while it is awake. Reminders need the paid plan before real users (D99).
 */

const DELIVER = "deliver-messages";

const globalForJobs = globalThis as unknown as { bookbeautyJobs?: Promise<PgBoss | null> };

async function start(): Promise<PgBoss | null> {
  const boss = new PgBoss({ connectionString: env.DATABASE_URL, schema: "pgboss" });
  boss.on("error", (error) => console.error("[jobs]", error));
  await boss.start();
  // "stately": at most one waiting and one running, so many nudges make one run.
  await boss.createQueue(DELIVER, { policy: "stately", retryLimit: 1 });
  await boss.schedule(DELIVER, "* * * * *");
  await boss.work(DELIVER, async () => {
    await deliverDueMessages();
  });
  onMessageQueued(() => {
    boss.send(DELIVER, null).catch((error: unknown) => console.error("[jobs] nudge failed", error));
  });
  console.info("[jobs] started");
  return boss;
}

/** Starts the background jobs once per server process. Failure is logged, not fatal: pages still work. */
export function startJobs() {
  globalForJobs.bookbeautyJobs ??= start().catch((error: unknown) => {
    console.error("[jobs] could not start", error);
    return null;
  });
  return globalForJobs.bookbeautyJobs;
}
