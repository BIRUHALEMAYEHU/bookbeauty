import postgres from "postgres";
import { afterAll, describe, expect, it } from "vitest";

const sql = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });

afterAll(async () => {
  await sql.end();
});

describe("test database", () => {
  it("has the extensions the data model relies on", async () => {
    const rows = await sql<{ extname: string }[]>`
      select extname from pg_extension where extname in ('citext', 'btree_gist') order by extname
    `;
    expect(rows.map((r) => r.extname)).toEqual(["btree_gist", "citext"]);
  });

  it("can generate time-ordered UUIDs", async () => {
    const [row] = await sql<{ id: string }[]>`select uuidv7() as id`;
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
  });
});
