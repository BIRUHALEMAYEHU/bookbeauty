CREATE TYPE "public"."service_location_type" AS ENUM('studio', 'client_place', 'both');--> statement-breakpoint
CREATE TYPE "public"."service_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "service_providers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "services" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"buffer_minutes" integer DEFAULT 0 NOT NULL,
	"location_type" "service_location_type" DEFAULT 'studio' NOT NULL,
	"price_studio" integer,
	"price_client_place" integer,
	"currency" text DEFAULT 'ETB' NOT NULL,
	"requires_approval" boolean,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"status" "service_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "services_duration_positive" CHECK ("services"."duration_minutes" > 0),
	CONSTRAINT "services_buffer_not_negative" CHECK ("services"."buffer_minutes" >= 0),
	CONSTRAINT "services_prices_not_negative" CHECK (coalesce("services"."price_studio", 0) >= 0 and coalesce("services"."price_client_place", 0) >= 0),
	CONSTRAINT "services_price_matches_location" CHECK (("services"."location_type" = 'client_place' or "services"."price_studio" is not null)
        and ("services"."location_type" = 'studio' or "services"."price_client_place" is not null))
);
--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_providers" ADD CONSTRAINT "service_providers_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "services" ADD CONSTRAINT "services_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "service_providers_unique" ON "service_providers" USING btree ("service_id","membership_id");--> statement-breakpoint
CREATE INDEX "service_providers_membership_id_idx" ON "service_providers" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "service_providers_business_id_idx" ON "service_providers" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "services_business_id_idx" ON "services" USING btree ("business_id");