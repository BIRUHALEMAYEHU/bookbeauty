// Applies pending database migrations. Runs before the app starts on each
// deploy (render.yaml). Uses only runtime dependencies, so it works where
// development tools such as drizzle-kit are not installed.
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await migrate(drizzle(sql), { migrationsFolder: "src/db/migrations" });
  console.log("Migrations applied");
} catch (error) {
  console.error("Migration failed", error);
  process.exitCode = 1;
} finally {
  await sql.end();
}
