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

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    handle: text("handle").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("users_handle_unique").on(table.handle)],
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
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }).notNull(),
    payoutUnits: bigint("payout_units", { mode: "number" }),
    brier: doublePrecision("brier"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("outcomes_pick_unique").on(table.pickId)],
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
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (table) => [
    index("signals_provider_idx").on(table.provider),
    uniqueIndex("signals_provider_external_unique").on(table.provider, table.externalRef),
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
export type AnalystRow = typeof analysts.$inferSelect;
export type PickRow = typeof picks.$inferSelect;
export type OutcomeRow = typeof outcomes.$inferSelect;
export type SignalRow = typeof signals.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type MemoryWriteRow = typeof memoryWrites.$inferSelect;
export type RecommendationRow = typeof recommendations.$inferSelect;
