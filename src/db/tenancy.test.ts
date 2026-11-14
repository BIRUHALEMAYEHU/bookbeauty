import { existsSync } from "node:fs";
import { getTableColumns, isTable } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "./schema";
import tenancy from "./tenant-tables.json";

const tables = Object.entries(schema).filter(([, value]) => isTable(value)) as [
  string,
  Parameters<typeof getTableColumns>[0],
][];

function hasBusinessId(table: Parameters<typeof getTableColumns>[0]) {
  return Object.values(getTableColumns(table)).some((column) => column.name === "business_id");
}

describe("tenant table list", () => {
  it("lists every table that has a business_id column", () => {
    const withBusinessId = tables.filter(([, table]) => hasBusinessId(table)).map(([name]) => name);
    const missing = withBusinessId.filter((name) => !tenancy.tables.includes(name));
    // A new business table must be added to src/db/tenant-tables.json so the lint rule guards it.
    expect(missing).toEqual([]);
  });

  it("names only real tables, and only business_id tables under tables", () => {
    const names = new Map(tables);
    for (const name of tenancy.tables) {
      expect(names.has(name), name).toBe(true);
      expect(hasBusinessId(names.get(name)!), name).toBe(true);
    }
    for (const name of Object.keys(tenancy.alsoGuarded)) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it("names files and folders that exist", () => {
    for (const entry of [...tenancy.databaseFiles, ...tenancy.platformFiles]) {
      const path = entry.replace(/\/\*\*$/, "");
      expect(existsSync(path), entry).toBe(true);
    }
  });

  it("only gives business-table access to files that may use the database", () => {
    for (const entry of tenancy.platformFiles) {
      const covered = tenancy.databaseFiles.some(
        (allowed) =>
          allowed === entry ||
          (allowed.endsWith("/**") && entry.startsWith(allowed.slice(0, -2))),
      );
      expect(covered, entry).toBe(true);
    }
  });
});
