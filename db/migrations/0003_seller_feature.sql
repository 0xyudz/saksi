CREATE TYPE "public"."outcome_verification" AS ENUM('self_attested', 'oracle_verified', 'oracle_contradicted');--> statement-breakpoint
CREATE TABLE "wallet_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"address" text NOT NULL,
	"nonce" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "verification" "outcome_verification" DEFAULT 'self_attested' NOT NULL;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "oracle_result" "outcome_result";--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "oracle_source" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "oracle_event_id" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "oracle_note" text;--> statement-breakpoint
ALTER TABLE "outcomes" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "picks" ADD COLUMN "oracle_event_ref" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "seller_id" uuid;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "pay_to_address" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "listing_fee_digest" text;--> statement-breakpoint
ALTER TABLE "signals" ADD COLUMN "listing_fee_atomic" bigint;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_address" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "wallet_bound_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_challenges_nonce_unique" ON "wallet_challenges" USING btree ("nonce");--> statement-breakpoint
CREATE INDEX "wallet_challenges_address_idx" ON "wallet_challenges" USING btree ("address");--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outcomes_verification_idx" ON "outcomes" USING btree ("verification");--> statement-breakpoint
CREATE INDEX "signals_seller_idx" ON "signals" USING btree ("seller_id");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_listing_fee_unique" ON "signals" USING btree ("listing_fee_digest");--> statement-breakpoint
CREATE UNIQUE INDEX "users_wallet_unique" ON "users" USING btree ("wallet_address");