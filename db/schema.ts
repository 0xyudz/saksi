import {
  bigint,
  doublePrecision,
  index,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import type { JsonObject, PickPayload, RecommendationResponse } from "@/lib/domain";

export const analystKindEnum = pgEnum("analyst_kind", ["human", "agent", "source"]);

export const pickStatusEnum = pgEnum("pick_status", ["sealed", "revealed", "resolved", "void"]);

export const outcomeResultEnum = pgEnum("outcome_result", ["win", "loss", "void"]);

/**
 * How an outcome came to exist. `self_attested` is the owner's own claim and is never
 * treated as evidence of skill; `oracle` means an independent results provider agreed.
 */
export const outcomeVerificationEnum = pgEnum("outcome_verification", [
  "self_attested",
  "oracle_verified",
  "oracle_contradicted",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    /**
     * scrypt hash of the recovery code shown once at journal creation. Null for journals
     * created before recovery existed; those cannot be resumed.
     */
    recoveryHash: text("recovery_hash"),
    /**
     * Sui address proven to belong to this journal through a signed personal message.
     * Unique: one wallet can only ever claim one handle. Null means the journal has not
     * bound a wallet yet, and therefore cannot sell signals.
     */
    walletAddress: text("wallet_address"),
    /** When the wallet binding was proven. Kept for audit, not used for authorisation. */
    walletBoundAt: timestamp("wallet_bound_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_handle_unique").on(table.handle),
    uniqueIndex("users_wallet_unique").on(table.walletAddress),
  ],
);

/**
 * Single-use challenges for wallet binding. Stored in Postgres rather than memory because
 * serverless instances do not share process state, and a replayed nonce would let anyone
 * rebind a wallet they do not control.
 */
export const walletChallenges = pgTable(
  "wallet_challenges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    address: text("address").notNull(),
    nonce: text("nonce").notNull(),
    /**
     * What the signature will be used for. Committing to this in the signed message stops
     * a signature harvested for one action from being replayed for another.
     */
    purpose: text("purpose").notNull(),
    /**
     * The action's target: the handle being claimed, or the journal id being bound.
     * Null for a plain login, where the wallet itself identifies the journal.
     */
    subject: text("subject"),
    /**
     * The exact bytes the wallet was asked to sign. Stored rather than rebuilt so
     * verification can never drift from what the user actually approved, even if the
     * message template changes later.
     */
    message: text("message").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("wallet_challenges_nonce_unique").on(table.nonce),
    index("wallet_challenges_address_idx").on(table.address),
  ],
);

export const analysts = pgTable(
  "analysts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    kind: analystKindEnum("kind").notNull(),
    externalRef: text("external_ref"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("analysts_name_kind_unique").on(table.name, table.kind)],
);

export const picks = pgTable(
  "picks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    analystId: uuid("analyst_id")
      .notNull()
      .references(() => analysts.id, { onDelete: "restrict" }),
    eventRef: text("event_ref").notNull(),
    market: text("market").notNull(),
    selection: text("selection").notNull(),
    odds: doublePrecision("odds").notNull(),
    stakeUnits: bigint("stake_units", { mode: "number" }).notNull(),
    commitmentHash: text("commitment_hash").notNull(),
    pickPayload: jsonb("pick_payload").$type<PickPayload>().notNull(),
    /**
     * Optional pointer to an independent results fixture (e.g. `espn:eng.1:401879254`).
     * Deliberately outside `pickPayload`: adding it to the hashed payload would invalidate
     * every commitment sealed before this column existed.
     */
    oracleEventRef: text("oracle_event_ref"),
    committedAt: timestamp("committed_at", { withTimezone: true, mode: "date" }).notNull(),
    revealAt: timestamp("reveal_at", { withTimezone: true, mode: "date" }),
    status: pickStatusEnum("status").notNull().default("sealed"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("picks_user_idx").on(table.userId),
    index("picks_analyst_idx").on(table.analystId),
    index("picks_status_idx").on(table.status),
  ],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pickId: uuid("pick_id")
      .notNull()
      .references(() => picks.id, { onDelete: "cascade" }),
    result: outcomeResultEnum("result").notNull(),
    resolvedBy: text("resolved_by").notNull(),
    sourceUrl: text("source_url").notNull(),
    /**
     * Whether an independent results provider agreed with `result`. Only
     * `oracle_verified` outcomes count towards a seller's verified record; everything
     * else is the owner grading their own homework.
     */
    verification: outcomeVerificationEnum("verification").notNull().default("self_attested"),
    /** The oracle's own verdict, kept even when it contradicts the owner. */
    oracleResult: outcomeResultEnum("oracle_result"),
    /** Provider that produced the independent result, e.g. `espn:eng.1`. */
    oracleSource: text("oracle_source"),
    /** Provider fixture id, so the claim can be re-checked by anyone. */
    oracleEventId: text("oracle_event_id"),
    /** Why the oracle could not be consulted, when it could not. */
    oracleNote: text("oracle_note"),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    payoutUnits: bigint("payout_units", { mode: "number" }),
    brier: doublePrecision("brier"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("outcomes_pick_unique").on(table.pickId),
    index("outcomes_verification_idx").on(table.verification),
  ],
);

export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    externalRef: text("external_ref").notNull(),
    provider: text("provider").notNull(),
    title: text("title").notNull(),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    priceAtomic: bigint("price_atomic", { mode: "bigint" }).notNull(),
    asset: text("asset").notNull(),
    /**
     * The journal that listed this signal. Null for catalogue rows created before selling
     * existed; those are paid to the platform address.
     */
    sellerId: uuid("seller_id").references(() => users.id, { onDelete: "set null" }),
    /**
     * Where x402 sends the buyer's payment for this signal. Copied from the seller's
     * proven wallet at listing time so a later wallet change cannot redirect a live
     * listing's proceeds without a new settlement.
     */
    payToAddress: text("pay_to_address"),
    /**
     * Digest of the listing fee the seller paid to the platform. A signal is only
     * visible in the catalogue once this is verified, which is what makes the platform
     * fee enforceable without holding anyone's money.
     */
    listingFeeDigest: text("listing_fee_digest"),
    /** Atomic amount of the listing fee that was actually settled. */
    listingFeeAtomic: bigint("listing_fee_atomic", { mode: "bigint" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("signals_provider_idx").on(table.provider),
    index("signals_seller_idx").on(table.sellerId),
    uniqueIndex("signals_provider_external_unique").on(table.provider, table.externalRef),
    uniqueIndex("signals_listing_fee_unique").on(table.listingFeeDigest),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    pickId: uuid("pick_id").references(() => picks.id, { onDelete: "set null" }),
    signalId: uuid("signal_id")
      .notNull()
      .references(() => signals.id, { onDelete: "cascade" }),
    digest: text("digest").notNull(),
    /** The x402 resource URL that was paid for; null only for legacy rows. */
    resource: text("resource"),
    /** The facilitator paymentRequirements used when the settlement was authorized. */
    requirements: jsonb("requirements").$type<JsonObject>(),
    payer: text("payer").notNull(),
    payTo: text("pay_to").notNull(),
    amountAtomic: bigint("amount_atomic", { mode: "bigint" }).notNull(),
    network: text("network").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }).notNull(),
    raw: jsonb("raw").$type<JsonObject>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("payments_digest_unique").on(table.digest),
    index("payments_signal_idx").on(table.signalId),
    index("payments_payer_idx").on(table.payer),
  ],
);

export const memoryWrites = pgTable(
  "memory_writes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    blobId: text("blob_id").notNull(),
    jobId: text("job_id").notNull(),
    namespace: text("namespace").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("memory_writes_kind_idx").on(table.kind)],
);

export const recommendations = pgTable(
  "recommendations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pickId: uuid("pick_id").references(() => picks.id, { onDelete: "set null" }),
    query: text("query").notNull(),
    response: jsonb("response").$type<RecommendationResponse>().notNull(),
    citedMemoryIds: jsonb("cited_memory_ids").$type<string[]>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [index("recommendations_created_idx").on(table.createdAt)],
);

export type UserRow = typeof users.$inferSelect;
export type WalletChallengeRow = typeof walletChallenges.$inferSelect;
export type AnalystRow = typeof analysts.$inferSelect;
export type PickRow = typeof picks.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type MemoryWriteRow = typeof memoryWrites.$inferSelect;
export type RecommendationRow = typeof recommendations.$inferSelect;
