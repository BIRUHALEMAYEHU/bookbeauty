import { readFileSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// How code may reach the database (technical-plan Section 3). The lists live in
// src/db/tenant-tables.json:
// - feature modules may not import the database at all; they use forBusiness();
// - databaseFiles may import it, but not business tables;
// - platformFiles may import both.
const access = JSON.parse(readFileSync(new URL("./src/db/tenant-tables.json", import.meta.url)));
const guardedTables = [...access.tables, ...Object.keys(access.alsoGuarded)];

const MODULES = "src/modules/**/*.{ts,tsx}";
const TESTS = "**/*.test.ts";

const deepSchemaRule = {
  group: ["@/db/schema/*"],
  message: 'Import tables from "@/db/schema" so the access rules can see them.',
};

const noDatabase = {
  name: "@/db/client",
  message:
    "Feature code reaches business data only through forBusiness() in src/db/scope.ts, so every query is filtered by business. See src/db/tenant-tables.json.",
};

const noBusinessTables = {
  name: "@/db/schema",
  importNames: guardedTables,
  message:
    "Only the platform files in src/db/tenant-tables.json read business tables directly. Use forBusiness() instead.",
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: [MODULES],
    ignores: [TESTS, ...access.databaseFiles],
    rules: {
      "no-restricted-imports": ["error", { paths: [noDatabase], patterns: [deepSchemaRule] }],
    },
  },
  {
    files: access.databaseFiles,
    ignores: [TESTS, ...access.platformFiles],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: [noBusinessTables], patterns: [deepSchemaRule] },
      ],
    },
  },
  {
    // Pages and routes call modules; they never query the database themselves.
    files: ["src/app/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@/db/client",
              message: "Pages and routes call a module function instead of querying the database.",
            },
            {
              name: "@/db/schema",
              allowTypeImports: true,
              message: "Pages and routes call a module function instead of querying the database.",
            },
          ],
          patterns: [deepSchemaRule],
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
