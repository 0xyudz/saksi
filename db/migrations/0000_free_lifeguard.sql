CREATE TYPE "public"."analyst_kind" AS ENUM('human', 'agent', 'source');--> statement-breakpoint
CREATE TYPE "public"."outcome_result" AS ENUM('win', 'loss', 'void');--> statement-breakpoint
CREATE TYPE "public"."pick_status" AS ENUM('sealed', 'revealed', 'resolved', 'void');--> statement-breakpoint
CREATE TABLE "analysts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"kind" "analyst_kind" NOT NULL,
	"external_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memory_writes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"blob_id" text NOT NULL,
	"job_id" text NOT NULL,
	"namespace" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pick_id" uuid NOT NULL,
	"result" "outcome_result" NOT NULL,
	"resolved_by" text NOT NULL,
	"source_url" text NOT NULL,
	"resolved_at" timestamp with time zone NOT NULL,
	"payout_units" bigint,
	"brier" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"pick_id" uuid,
	"signal_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"payer" text NOT NULL,
	"pay_to" text NOT NULL,
	"amount_atomic" bigint NOT NULL,
	"network" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "picks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"analyst_id" uuid NOT NULL,
	"event_ref" text NOT NULL,
	"market" text NOT NULL,
	"selection" text NOT NULL,
	"odds" double precision NOT NULL,
	"stake_units" bigint NOT NULL,
	"commitment_hash" text NOT NULL,
	"pick_payload" jsonb NOT NULL,
	"committed_at" timestamp with time zone NOT NULL,
	"reveal_at" timestamp with time zone,
	"status" "pick_status" DEFAULT 'sealed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recommendations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pick_id" uuid,
	"query" text NOT NULL,
	"response" jsonb NOT NULL,
	"cited_memory_ids" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"external_ref" text NOT NULL,
	"provider" text NOT NULL,
	"title" text NOT NULL,
	"payload" jsonb NOT NULL,
	"price_atomic" bigint NOT NULL,
	"asset" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "outcomes" ADD CONSTRAINT "outcomes_pick_id_picks_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."picks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_pick_id_picks_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."picks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "picks" ADD CONSTRAINT "picks_analyst_id_analysts_id_fk" FOREIGN KEY ("analyst_id") REFERENCES "public"."analysts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recommendations" ADD CONSTRAINT "recommendations_pick_id_picks_id_fk" FOREIGN KEY ("pick_id") REFERENCES "public"."picks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysts_name_kind_unique" ON "analysts" USING btree ("name","kind");--> statement-breakpoint
CREATE INDEX "memory_writes_kind_idx" ON "memory_writes" USING btree ("kind");--> statement-breakpoint
CREATE UNIQUE INDEX "outcomes_pick_unique" ON "outcomes" USING btree ("pick_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_digest_unique" ON "payments" USING btree ("digest");--> statement-breakpoint
CREATE INDEX "payments_signal_idx" ON "payments" USING btree ("signal_id");--> statement-breakpoint
CREATE INDEX "payments_payer_idx" ON "payments" USING btree ("payer");--> statement-breakpoint
CREATE INDEX "picks_user_idx" ON "picks" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "picks_analyst_idx" ON "picks" USING btree ("analyst_id");--> statement-breakpoint
CREATE INDEX "picks_status_idx" ON "picks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "recommendations_created_idx" ON "recommendations" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "signals_provider_idx" ON "signals" USING btree ("provider");--> statement-breakpoint
CREATE UNIQUE INDEX "signals_provider_external_unique" ON "signals" USING btree ("provider","external_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "users_handle_unique" ON "users" USING btree ("handle");