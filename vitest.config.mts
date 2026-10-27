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
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/db/test-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      SESSION_SECRET:
        process.env.SESSION_SECRET ?? "test-session-secret-at-least-32-chars",
      APP_URL: process.env.APP_URL ?? "http://localhost:3000",
    },
  },
});
