CREATE TYPE "public"."approval_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."business_category" AS ENUM('hair', 'barber', 'nails', 'makeup', 'lashes', 'spa', 'other');--> statement-breakpoint
CREATE TYPE "public"."business_kind" AS ENUM('independent', 'salon');--> statement-breakpoint
CREATE TYPE "public"."business_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."location_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TYPE "public"."membership_end_reason" AS ENUM('resigned', 'removed');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('owner', 'branch_manager', 'receptionist', 'stylist');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'requested', 'active', 'notice', 'ended');--> statement-breakpoint
CREATE TABLE "businesses" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"kind" "business_kind" NOT NULL,
	"name" text NOT NULL,
	"slug" "citext",
	"category" "business_category" NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"about" text,
	"phone" text,
	"logo_media_id" uuid,
	"time_zone" text DEFAULT 'Africa/Addis_Ababa' NOT NULL,
	"approval_mode" "approval_mode" DEFAULT 'auto' NOT NULL,
	"min_notice_minutes" integer DEFAULT 120 NOT NULL,
	"max_advance_days" integer DEFAULT 60 NOT NULL,
	"notice_period_days" integer DEFAULT 14 NOT NULL,
	"exclusive_staff" boolean DEFAULT false NOT NULL,
	"status" "business_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"location_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"invited_contact" text,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"created_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" "citext" NOT NULL,
	"address_text" text,
	"latitude" double precision,
	"longitude" double precision,
	"address_public" boolean DEFAULT true NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"status" "location_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "membership_locations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"membership_id" uuid NOT NULL,
	"location_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "membership_role" NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_day" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"end_reason" "membership_end_reason",
	"travel_buffer_minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "professional_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"user_id" uuid NOT NULL,
	"handle" "citext" NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_media_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "businesses" ADD CONSTRAINT "businesses_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_by_user_id_users_id_fk" FOREIGN KEY ("accepted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "locations" ADD CONSTRAINT "locations_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_locations" ADD CONSTRAINT "membership_locations_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "membership_locations" ADD CONSTRAINT "membership_locations_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "professional_profiles" ADD CONSTRAINT "professional_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_slug_unique" ON "businesses" USING btree ("slug") WHERE "businesses"."slug" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "businesses_one_independent_per_owner" ON "businesses" USING btree ("owner_user_id") WHERE "businesses"."kind" = 'independent' and "businesses"."status" = 'active';--> statement-breakpoint
CREATE INDEX "businesses_owner_user_id_idx" ON "businesses" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_unique" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_business_id_idx" ON "invitations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_business_slug_unique" ON "locations" USING btree ("business_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "locations_one_default_per_business" ON "locations" USING btree ("business_id") WHERE "locations"."is_default" = true;--> statement-breakpoint
CREATE INDEX "locations_business_id_idx" ON "locations" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_locations_unique" ON "membership_locations" USING btree ("membership_id","location_id");--> statement-breakpoint
CREATE INDEX "membership_locations_location_id_idx" ON "membership_locations" USING btree ("location_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_one_open_per_user_business" ON "memberships" USING btree ("business_id","user_id") WHERE "memberships"."status" <> 'ended';--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "memberships_business_id_idx" ON "memberships" USING btree ("business_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_profiles_user_id_unique" ON "professional_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "professional_profiles_handle_unique" ON "professional_profiles" USING btree ("handle");