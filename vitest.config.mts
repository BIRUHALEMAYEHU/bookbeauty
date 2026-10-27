import { defineConfig } from "vitest/config";

try {
  process.loadEnvFile(".env");
} catch {
  // Variables may already be set, for example in CI.
}

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globalSetup: ["src/db/test-setup.ts"],
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
    },
  },
});
