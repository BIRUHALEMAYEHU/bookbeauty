CREATE TYPE "public"."session_audience" AS ENUM('app', 'admin');--> statement-breakpoint
ALTER TABLE "sessions" ADD COLUMN "audience" "session_audience" DEFAULT 'app' NOT NULL;