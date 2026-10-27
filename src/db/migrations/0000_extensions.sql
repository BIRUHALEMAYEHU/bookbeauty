-- Case-insensitive text for handles, slugs and emails.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
-- Lets one exclusion constraint combine "same professional" (=) with "overlapping time" (&&),
-- which is how double-booking is prevented in the database.
CREATE EXTENSION IF NOT EXISTS btree_gist;
