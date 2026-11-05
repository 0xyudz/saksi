import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { payments, signals, type SignalRow } from "@/db/schema";
import type { JsonObject } from "@/lib/domain";

/** The two facts x402 needs to build a challenge for one signal. */
export interface ListingPaymentTarget {
  readonly payToAddress: string;
  readonly priceAtomic: bigint;
}

/**
 * Resolves where a buyer's money should go for a given signal.
 *
 * A listed signal points at its seller's wallet. A catalogue row with no seller falls
 * back to the platform address, which is what the pre-marketplace rows are. Anything
 * unlisted returns null so the caller decides, rather than silently charging the platform.
 */
export async function findListingForPayment(
  signalId: string,
): Promise<ListingPaymentTarget | null> {
  const rows = await getDb()
    .select({
      payToAddress: signals.payToAddress,
      priceAtomic: signals.priceAtomic,
    })
    .from(signals)
    .where(eq(signals.id, signalId))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.payToAddress === null) return null;
  return { payToAddress: row.payToAddress, priceAtomic: row.priceAtomic };
}

export interface ListingInput {
  readonly sellerRef: string;
  readonly payToAddress: string;
  readonly externalRef: string;
  readonly provider: string;
  readonly title: string;
  readonly payload: JsonObject;
  readonly priceAtomic: bigint;
  readonly asset: string;
  readonly listingFeeDigest: string;
  readonly listingFeeAtomic: bigint;
}

/**
 * Inserts a listing that has already been paid for.
 *
 * The listing fee digest is unique, so one settlement can publish exactly one signal; a
 * seller cannot replay a single fee across many listings. `onConflictDoNothing` on the
 * provider/external pair keeps a seller from duplicating a catalogue entry.
 */
export async function insertListing(input: ListingInput): Promise<SignalRow | null> {
  const inserted = await getDb()
    .insert(signals)
    .values({
      sellerRef: input.sellerRef,
      payToAddress: input.payToAddress,
      externalRef: input.externalRef,
      provider: input.provider,
      title: input.title,
      payload: input.payload,
      priceAtomic: input.priceAtomic,
      asset: input.asset,
      listingFeeDigest: input.listingFeeDigest,
      listingFeeAtomic: input.listingFeeAtomic,
    })
    .onConflictDoNothing()
    .returning();

  return inserted[0] ?? null;
}

export interface SellerListing {
  readonly signal: SignalRow;
  readonly purchases: number;
  readonly earnedAtomic: bigint;
}

/**
 * A seller's own listings with what they have actually earned.
 *
 * `earnedAtomic` sums verified payments for that signal, which is money that already
 * landed in the seller's wallet — Saksi never held it. Nothing here is an estimate.
 */
export async function listingsForSeller(sellerRef: string): Promise<SellerListing[]> {
  const rows = await getDb()
    .select({
      signal: signals,
      purchases: sql<number>`count(${payments.id})::int`,
      earnedAtomic: sql<string>`coalesce(sum(${payments.amountAtomic}), 0)::text`,
    })
    .from(signals)
    .leftJoin(payments, eq(payments.signalId, signals.id))
    .where(eq(signals.sellerRef, sellerRef))
    .groupBy(signals.id)
    .orderBy(desc(signals.createdAt));

  return rows.map((row) => ({
    signal: row.signal,
    purchases: row.purchases,
    earnedAtomic: BigInt(row.earnedAtomic),
  }));
}

export interface SellerSummary {
  readonly listings: number;
  readonly purchases: number;
  readonly earnedAtomic: bigint;
  readonly listingFeesAtomic: bigint;
}

export async function sellerSummary(sellerRef: string): Promise<SellerSummary> {
  const listingRows = await getDb()
    .select({
      listings: sql<number>`count(*)::int`,
      listingFeesAtomic: sql<string>`coalesce(sum(${signals.listingFeeAtomic}), 0)::text`,
    })
    .from(signals)
    .where(eq(signals.sellerRef, sellerRef));

  const salesRows = await getDb()
    .select({
      purchases: sql<number>`count(${payments.id})::int`,
      earnedAtomic: sql<string>`coalesce(sum(${payments.amountAtomic}), 0)::text`,
    })
    .from(payments)
    .innerJoin(signals, eq(signals.id, payments.signalId))
    .where(eq(signals.sellerRef, sellerRef));

  return {
    listings: listingRows[0]?.listings ?? 0,
    listingFeesAtomic: BigInt(listingRows[0]?.listingFeesAtomic ?? "0"),
    purchases: salesRows[0]?.purchases ?? 0,
    earnedAtomic: BigInt(salesRows[0]?.earnedAtomic ?? "0"),
  };
}

/**
 * Every signal that carries a seller, used by the catalogue to show who is behind it.
 *
 * The seller's wallet is the ref itself, so no join is needed to know where money goes. The
 * handle is a display name read from that journal's own memory afterwards; a journal whose
 * handle cannot be read still shows its address rather than disappearing from the catalogue.
 */
export async function listListedSignals(limit = 50): Promise<
  ReadonlyArray<{
    signal: SignalRow;
    sellerWallet: string | null;
    purchases: number;
  }>
> {
  const rows = await getDb()
    .select({
      signal: signals,
      purchases: sql<number>`count(${payments.id})::int`,
    })
    .from(signals)
    .leftJoin(payments, eq(payments.signalId, signals.id))
    .where(isNotNull(signals.listingFeeDigest))
    .groupBy(signals.id)
    .orderBy(desc(signals.createdAt))
    .limit(limit);

  return rows.map((row) => ({
    signal: row.signal,
    sellerWallet: row.signal.sellerRef,
    purchases: row.purchases,
  }));
}

/** True when this digest has already published a listing. */
export async function listingFeeUsed(digest: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: signals.id })
    .from(signals)
    .where(eq(signals.listingFeeDigest, digest))
    .limit(1);
  return rows.length > 0;
}

/** The listing a settlement digest published, if any. Used to recover a paid digest. */
export async function findListingByFeeDigest(digest: string): Promise<SignalRow | null> {
  const rows = await getDb()
    .select()
    .from(signals)
    .where(eq(signals.listingFeeDigest, digest))
    .limit(1);
  return rows[0] ?? null;
}

/** A journal cannot list the same external reference twice. */
export async function sellerHasExternalRef(
  sellerRef: string,
  externalRef: string,
): Promise<boolean> {
  const rows = await getDb()
    .select({ id: signals.id })
    .from(signals)
    .where(and(eq(signals.sellerRef, sellerRef), eq(signals.externalRef, externalRef)))
    .limit(1);
  return rows.length > 0;
}
