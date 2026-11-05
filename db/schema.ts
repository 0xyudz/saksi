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

/*
 * There is no `users` table.
 *
 * A journal is identified by the Sui address that proved ownership of it, so the identity
 * is self-certifying and needs no row to exist. Every table that used to hold a `user_id`
 * foreign key now holds a `journal_ref`: a lowercase Sui address, or — for journals created
 * before this change — the uuid they were known by. Both forms are accepted because Walrus
 * is append-only: old memories live in `saksi:<uuid>` and cannot be moved, so the old ref
 * has to stay resolvable rather than be rewritten.
 *
 * The handle survives as a display name stored in Walrus Memory, not as a key. Two journals
 * may share one, because nothing authorises on it any more.
 */

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
    /**
     * The journal that owns this pick: a Sui address, or a legacy uuid. Deliberately a
     * plain column rather than a foreign key, because there is no journal table to point
     * at — the wallet is the identity and it is proven by signature, not by a row.
     */
    journalRef: text("journal_ref").notNull(),
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
    index("picks_journal_idx").on(table.journalRef),
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
     * The journal that listed this signal: a Sui address or legacy uuid. Null for
     * catalogue rows created before selling existed; those are paid to the platform.
     */
    sellerRef: text("seller_ref"),
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
    index("signals_seller_idx").on(table.sellerRef),
    uniqueIndex("signals_provider_external_unique").on(table.provider, table.externalRef),
    uniqueIndex("signals_listing_fee_unique").on(table.listingFeeDigest),
  ],
);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /**
     * The journal that bought this signal, when known. A settlement can be recorded before
     * any journal claims it, so this is nullable and filled in later by digest.
     */
    journalRef: text("journal_ref"),
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

export type WalletChallengeRow = typeof walletChallenges.$inferSelect;
export type AnalystRow = typeof analysts.$inferSelect;
export type PickRow = typeof picks.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type RecommendationRow = typeof recommendations.$inferSelect;
