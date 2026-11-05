-- Identity moves from a `users` row to the wallet itself.
--
-- A journal is now identified by the Sui address that proved ownership of it. Nothing is
-- registered, so there is no row to own and no handle to be unique.
--
-- This migration is a data migration, not just a schema change: existing rows are rewritten
-- so no history is lost.
--
--   1. `picks.user_id` (uuid FK) becomes `picks.journal_ref` (text). Existing picks keep the
--      uuid they were created under, because their memories already live in `saksi:<uuid>`
--      and Walrus is append-only. Those refs stay readable forever.
--   2. `signals.seller_id` becomes `signals.seller_ref` (text), same reasoning.
--   3. `payments.user_id` becomes `payments.journal_ref` (text), nullable as before.
--   4. `users` is dropped. Its three guarantees are replaced as follows:
--        - wallet uniqueness  -> the wallet *is* the ref, so it cannot collide
--        - handle uniqueness  -> given up on purpose; a handle is a display name now
--        - recovery lookup    -> a namespace named after the code's SHA-256 digest
--
-- The legacy uuid refs are deliberately kept rather than rewritten to addresses: rewriting
-- them would orphan every memory already written under `saksi:<uuid>`.

ALTER TABLE "picks" ADD COLUMN "journal_ref" text;
UPDATE "picks" SET "journal_ref" = "user_id"::text WHERE "journal_ref" IS NULL;
ALTER TABLE "picks" ALTER COLUMN "journal_ref" SET NOT NULL;

ALTER TABLE "signals" ADD COLUMN "seller_ref" text;
UPDATE "signals" SET "seller_ref" = "seller_id"::text WHERE "seller_id" IS NOT NULL;
ALTER TABLE "payments" ADD COLUMN "journal_ref" text;
UPDATE "payments" SET "journal_ref" = "user_id"::text WHERE "user_id" IS NOT NULL;

DROP INDEX IF EXISTS "picks_user_idx";
DROP INDEX IF EXISTS "signals_seller_idx";
CREATE INDEX "picks_journal_idx" ON "picks" ("journal_ref");
CREATE INDEX "signals_seller_idx" ON "signals" ("seller_ref");

ALTER TABLE "picks" DROP CONSTRAINT IF EXISTS "picks_user_id_users_id_fk";
ALTER TABLE "signals" DROP CONSTRAINT IF EXISTS "signals_seller_id_users_id_fk";
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_user_id_users_id_fk";

ALTER TABLE "picks" DROP COLUMN "user_id";
ALTER TABLE "signals" DROP COLUMN "seller_id";
ALTER TABLE "payments" DROP COLUMN "user_id";

DROP TABLE "users";
