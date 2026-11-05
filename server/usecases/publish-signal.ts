import { z } from "zod";

import type { SignalRow } from "@/db/schema";
import { verifyPayment } from "@/integrations/tatum/verify-payment";
import { GASLESS_MIN_ATOMIC } from "@/lib/config";
import { getEnv, listingFeeAtomic } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getLogger } from "@/lib/logger";
import type { JsonObject } from "@/lib/domain";
import {
  findListingByFeeDigest,
  insertListing,
  listingFeeUsed,
  sellerHasExternalRef,
} from "@/server/data/listings";
import type { SellerIdentity } from "@/server/auth";

/**
 * A seller sets their own price. The floor is the Sui gasless minimum: a cheaper signal
 * would build a sponsored transaction the network rejects, so the buyer could never pay.
 * The ceiling is a sanity bound, not a policy.
 *
 * The value must be a whole number of atomic units. A USD string such as `"0.05"` is
 * rejected by the regex *before* `BigInt` runs, because converting it inside `transform`
 * would throw a `SyntaxError` that `safeParse` cannot report and the route would answer
 * 500 instead of explaining the mistake.
 */
const priceAtomicSchema = z
  .union([z.string(), z.number()])
  .transform((value) => String(value).trim())
  .pipe(z.string().regex(/^\d+$/, "price must be a whole number of atomic USDC units"))
  .transform((value) => BigInt(value))
  .refine((value) => value >= GASLESS_MIN_ATOMIC, {
    message: `price must be at least ${GASLESS_MIN_ATOMIC.toString()} atomic units`,
  })
  .refine((value) => value <= 100_000_000n, {
    message: "price must not exceed 100 USDC",
  });

export const publishSignalSchema = z.object({
  /** What the buyer sees in the catalogue. */
  title: z.string().trim().min(4).max(200),
  /** The seller's own identifier for this signal, unique per seller. */
  externalRef: z.string().trim().min(1).max(200),
  /** Asking price in atomic USDC units. */
  priceAtomic: priceAtomicSchema,
  /**
   * The signal body, written by the seller. Marked synthetic by the UI unless the seller
   * is publishing real research; Saksi stores what it is given and claims nothing more.
   */
  payload: z.record(z.string(), z.unknown()),
  /** Digest of the listing-fee settlement the caller already made. */
  digest: z.string().trim().min(1).max(120),
});

export type PublishSignalInput = z.infer<typeof publishSignalSchema>;

/** The same listing, identified by a fee that has already been settled. */
export const recoverListingSchema = publishSignalSchema;

export type RecoverListingInput = z.infer<typeof recoverListingSchema>;

export interface PublishedSignal {
  readonly signal: SignalRow;
  readonly listingFeeAtomic: bigint;
  readonly explorerUrl: string;
}

export interface RecoveredListing extends PublishedSignal {
  readonly listingFeeDigest: string;
  /** True when this call created the row; false when it already existed. */
  readonly recovered: boolean;
}

/** The explorer link for a settlement, built from the network in use. */
function explorerUrlFor(digest: string): string {
  const network = getEnv().SUI_NETWORK;
  return network === "sui:mainnet"
    ? `https://suivision.xyz/txblock/${encodeURIComponent(digest)}`
    : `https://testnet.suivision.xyz/txblock/${encodeURIComponent(digest)}`;
}

/**
 * Publishes a signal after its listing fee has been verified on Sui.
 *
 * The order matters: the fee is confirmed against Tatum first, so a listing can never
 * become visible (and therefore purchasable) without the platform actually being paid.
 * That is what makes the fee enforceable without Saksi ever holding a buyer's money —
 * buyers pay the seller's wallet directly, and the platform's revenue is a separate,
 * one-off settlement it can verify on its own.
 */
export async function publishSignal(
  seller: SellerIdentity,
  input: PublishSignalInput,
): Promise<PublishedSignal> {
  const env = getEnv();
  const listingFee = listingFeeAtomic(env);

  if (await listingFeeUsed(input.digest)) {
    throw new AppError("CONFLICT", "That listing fee has already published a signal.");
  }

  if (await sellerHasExternalRef(seller.userId, seller.handle, input.externalRef)) {
    throw new AppError("CONFLICT", "You already listed a signal with that reference.");
  }

  const verified = await verifyPayment({
    digest: input.digest,
    payTo: env.X402_PAY_TO_ADDRESS,
    minAmountAtomic: listingFee,
    network: env.SUI_NETWORK,
  });

  const created = await insertListing({
    sellerId: seller.userId,
    payToAddress: seller.walletAddress,
    externalRef: input.externalRef,
    provider: seller.handle,
    title: input.title,
    payload: input.payload as JsonObject,
    priceAtomic: input.priceAtomic,
    asset: env.SUI_USDC_COIN_TYPE,
    listingFeeDigest: input.digest,
    listingFeeAtomic: verified.payment.amountAtomic,
  });

  if (!created) {
    // A concurrent request won the unique constraint on the fee digest or the reference.
    throw new AppError("CONFLICT", "That listing was already published.");
  }

  getLogger().info(
    {
      signalId: created.id,
      sellerId: seller.userId,
      listingFeeDigest: input.digest,
      listingFeeAtomic: verified.payment.amountAtomic.toString(),
    },
    "signal published",
  );

  return {
    signal: created,
    listingFeeAtomic: verified.payment.amountAtomic,
    explorerUrl: verified.payment.explorerUrl,
  };
}

/**
 * Publishes the listing a settled fee was paid for, without taking a second payment.
 *
 * The settlement is proven from chain here as well, so a caller cannot claim an unrelated
 * or smaller transaction. Recovery is idempotent: a digest that already published a
 * listing returns that listing instead of failing, which is what makes it safe for the
 * browser to call after an error it could not interpret.
 */
export async function recoverListing(
  seller: SellerIdentity,
  input: RecoverListingInput,
): Promise<RecoveredListing> {
  const env = getEnv();
  const listingFee = listingFeeAtomic(env);

  const existing = await findListingByFeeDigest(input.digest);
  if (existing) {
    if (existing.sellerId !== seller.userId) {
      throw new AppError("CONFLICT", "That listing fee belongs to another journal.");
    }
    return {
      signal: existing,
      listingFeeDigest: input.digest,
      listingFeeAtomic: existing.listingFeeAtomic ?? 0n,
      explorerUrl: explorerUrlFor(input.digest),
      recovered: true,
    };
  }

  if (await sellerHasExternalRef(seller.userId, seller.handle, input.externalRef)) {
    throw new AppError("CONFLICT", "You already listed a signal with that reference.");
  }

  // Proven from chain, not trusted from the request: the amount, the recipient and the
  // coin are all re-checked before the row is written.
  const verified = await verifyPayment({
    digest: input.digest,
    payTo: env.X402_PAY_TO_ADDRESS,
    minAmountAtomic: listingFee,
    network: env.SUI_NETWORK,
  });

  const created = await insertListing({
    sellerId: seller.userId,
    payToAddress: seller.walletAddress,
    externalRef: input.externalRef,
    provider: seller.handle,
    title: input.title,
    payload: input.payload as JsonObject,
    priceAtomic: input.priceAtomic,
    asset: env.SUI_USDC_COIN_TYPE,
    listingFeeDigest: input.digest,
    listingFeeAtomic: verified.payment.amountAtomic,
  });

  if (!created) {
    const raced = await findListingByFeeDigest(input.digest);
    if (raced && raced.sellerId === seller.userId) {
      return {
        signal: raced,
        listingFeeDigest: input.digest,
        listingFeeAtomic: raced.listingFeeAtomic ?? 0n,
        explorerUrl: verified.payment.explorerUrl,
        recovered: true,
      };
    }
    throw new AppError("CONFLICT", "That listing was already published.");
  }

  getLogger().info(
    {
      signalId: created.id,
      sellerId: seller.userId,
      listingFeeDigest: input.digest,
      listingFeeAtomic: verified.payment.amountAtomic.toString(),
    },
    "signal published from an existing settlement",
  );

  return {
    signal: created,
    listingFeeDigest: input.digest,
    listingFeeAtomic: verified.payment.amountAtomic,
    explorerUrl: verified.payment.explorerUrl,
    recovered: false,
  };
}
