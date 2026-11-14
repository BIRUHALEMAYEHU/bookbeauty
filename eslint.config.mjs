import { readFileSync } from "node:fs";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Business-owned tables may only be touched through the scoped data layer
// (src/db/scope.ts; technical-plan Section 3). The list lives in one file.
const tenancy = JSON.parse(readFileSync(new URL("./src/db/tenant-tables.json", import.meta.url)));
const guardedTables = [...tenancy.tables, ...Object.keys(tenancy.alsoGuarded)];

const schemaRule = {
  name: "@/db/schema",
  importNames: guardedTables,
  message:
    "Business data goes through forBusiness() in src/db/scope.ts, so every query is filtered by business. See src/db/tenant-tables.json.",
};

const deepSchemaRule = {
  group: ["@/db/schema/*"],
  message: 'Import tables from "@/db/schema" so the tenancy rule can see them.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/modules/**/*.{ts,tsx}"],
    ignores: ["**/*.test.ts", ...tenancy.platformFiles],
    rules: {
      "no-restricted-imports": ["error", { paths: [schemaRule], patterns: [deepSchemaRule] }],
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
