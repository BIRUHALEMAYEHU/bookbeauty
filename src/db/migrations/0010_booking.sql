CREATE TYPE "public"."appointment_assignment" AS ENUM('requested', 'auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."appointment_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."booking_source" AS ENUM('business_page', 'professional_page', 'staff');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('held', 'pending_approval', 'awaiting_deposit', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show', 'expired');--> statement-breakpoint
CREATE TYPE "public"."cancelled_by" AS ENUM('customer', 'business', 'system');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"booking_id" uuid NOT NULL,
	"business_id" uuid NOT NULL,
	"service_id" uuid NOT NULL,
	"membership_id" uuid,
	"professional_user_id" uuid,
	"assignment" "appointment_assignment" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"blocked_until" timestamp with time zone NOT NULL,
	"price" integer NOT NULL,
	"currency" text DEFAULT 'ETB' NOT NULL,
	"status" "appointment_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_times_in_order" CHECK ("appointments"."starts_at" < "appointments"."ends_at" and "appointments"."ends_at" <= "appointments"."blocked_until")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"location_id" uuid NOT NULL,
	"customer_record_id" uuid,
	"status" "booking_status" NOT NULL,
	"source" "booking_source" NOT NULL,
	"customer_name" text,
	"customer_phone" text,
	"customer_email" text,
	"at_client_place" boolean DEFAULT false NOT NULL,
	"client_address_text" text,
	"client_latitude" double precision,
	"client_longitude" double precision,
	"customer_notes" text,
	"total_price" integer NOT NULL,
	"currency" text DEFAULT 'ETB' NOT NULL,
	"amount_paid" integer,
	"payment_method" text,
	"hold_expires_at" timestamp with time zone,
	"approved_at" timestamp with time zone,
	"approved_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"completed_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by" "cancelled_by",
	"cancel_reason" text,
	"manage_token_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_total_not_negative" CHECK ("bookings"."total_price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "customer_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"date_of_birth" date,
	"allergies" text,
	"customer_notes" text,
	"marketing_opt_out_at" timestamp with time zone,
	"merged_into_id" uuid,
	"split_from_id" uuid,
	"visit_count" integer DEFAULT 0 NOT NULL,
	"total_spent" integer DEFAULT 0 NOT NULL,
	"last_visit_at" timestamp with time zone,
	"no_show_count" integer DEFAULT 0 NOT NULL,
	"cancellation_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_professional_user_id_users_id_fk" FOREIGN KEY ("professional_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_location_id_locations_id_fk" FOREIGN KEY ("location_id") REFERENCES "public"."locations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_record_id_customer_records_id_fk" FOREIGN KEY ("customer_record_id") REFERENCES "public"."customer_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_completed_by_user_id_users_id_fk" FOREIGN KEY ("completed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_records" ADD CONSTRAINT "customer_records_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_records" ADD CONSTRAINT "customer_records_merged_into_id_customer_records_id_fk" FOREIGN KEY ("merged_into_id") REFERENCES "public"."customer_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_records" ADD CONSTRAINT "customer_records_split_from_id_customer_records_id_fk" FOREIGN KEY ("split_from_id") REFERENCES "public"."customer_records"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_booking_id_idx" ON "appointments" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "appointments_business_starts_idx" ON "appointments" USING btree ("business_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_professional_starts_idx" ON "appointments" USING btree ("professional_user_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_manage_token_hash_unique" ON "bookings" USING btree ("manage_token_hash");--> statement-breakpoint
CREATE INDEX "bookings_business_status_idx" ON "bookings" USING btree ("business_id","status");--> statement-breakpoint
CREATE INDEX "bookings_customer_record_id_idx" ON "bookings" USING btree ("customer_record_id");--> statement-breakpoint
CREATE INDEX "bookings_held_expiry_idx" ON "bookings" USING btree ("hold_expires_at") WHERE "bookings"."status" = 'held';--> statement-breakpoint
CREATE INDEX "customer_records_business_phone_idx" ON "customer_records" USING btree ("business_id","phone");