import { customType } from "drizzle-orm/pg-core";

/** Case-insensitive text for emails, handles and slugs. */
export const citext = customType<{ data: string }>({
  dataType() {
    return "citext";
  },
});
