CREATE TYPE "public"."message_channel" AS ENUM('email', 'telegram', 'sms');--> statement-breakpoint
CREATE TYPE "public"."message_kind" AS ENUM('booking_confirmation', 'booking_request_received', 'booking_approved', 'booking_declined', 'booking_cancelled_by_business', 'booking_reminder', 'new_booking_notice', 'booking_cancelled_notice');--> statement-breakpoint
CREATE TYPE "public"."message_status" AS ENUM('queued', 'sending', 'sent', 'failed', 'cancelled', 'skipped_limit');--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"business_id" uuid NOT NULL,
	"kind" "message_kind" NOT NULL,
	"channel" "message_channel" NOT NULL,
	"recipient" text NOT NULL,
	"customer_record_id" uuid,
	"booking_id" uuid,
	"user_id" uuid,
	"status" "message_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"link_token" text,
	"sent_at" timestamp with time zone,
	"cost_units" integer DEFAULT 0 NOT NULL,
	"provider_message_id" text,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_business_id_businesses_id_fk" FOREIGN KEY ("business_id") REFERENCES "public"."businesses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_customer_record_id_customer_records_id_fk" FOREIGN KEY ("customer_record_id") REFERENCES "public"."customer_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messages_due_idx" ON "messages" USING btree ("scheduled_for") WHERE "messages"."status" = 'queued';--> statement-breakpoint
CREATE INDEX "messages_booking_id_idx" ON "messages" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "messages_business_created_idx" ON "messages" USING btree ("business_id","created_at");