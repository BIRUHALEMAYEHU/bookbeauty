import path from "node:path";
import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set, for example in CI.
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
    alias: {
      // server-only throws outside Next.js; tests run in plain Node.
      "server-only": path.resolve("src/test/server-only-stub.ts"),
    },
  },
  test: {
    environment: "node",
    // Database tests open a connection on their first query; slow machines need the room.
    testTimeout: 20_000,
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/db/test-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-chars",
      APP_URL: process.env.APP_URL ?? "http://localhost:3000",
      // Tests never use real outside services, even when .env has their keys.
      PLATFORM_ADMIN_EMAILS: "",
      SITE_URL: "",
      ADMIN_URL: "",
      RESEND_API_KEY: "",
      TURNSTILE_SITE_KEY: "",
      TURNSTILE_SECRET_KEY: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
      TELEGRAM_BOT_TOKEN: "",
      TELEGRAM_BOT_USERNAME: "",
    },
  },
});
