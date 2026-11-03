import { z } from "zod";

import type { SignalRow } from "@/db/schema";
import { verifyPayment } from "@/integrations/tatum/verify-payment";
import { GASLESS_MIN_ATOMIC } from "@/lib/config";
import { getEnv, listingFeeAtomic } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getLogger, errorForLog } from "@/lib/logger";
import type { JsonObject } from "@/lib/domain";
import { insertListing, listingFeeUsed, sellerHasExternalRef } from "@/server/data/listings";
import type { SellerIdentity } from "@/server/auth";

/**
 * A seller sets their own price. The floor is the Sui gasless minimum: a cheaper signal
 * would build a sponsored transaction the network rejects, so the buyer could never pay.
 * The ceiling is a sanity bound, not a policy.
 */
const priceAtomicSchema = z
  .union([z.string(), z.number()])
  .transform((value) => BigInt(String(value).trim()))
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

export interface PublishedSignal {
  readonly signal: SignalRow;
  readonly listingFeeAtomic: bigint;
  readonly explorerUrl: string;
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
      listingFeeAtomic: verified.payment.amountAtomic.toString(),
      digest: verified.payment.digest,
    },
    "signal published after listing fee settled",
  );

  return {
    signal: created,
    listingFeeAtomic: verified.payment.amountAtomic,
    explorerUrl: verified.payment.explorerUrl,
  };
}

/** Exposed for the UI so the listing form can show the real fee before signing. */
export function currentListingFeeAtomic(): bigint {
  return listingFeeAtomic();
}

/** Logs and rethrows, so the route keeps one error path. */
export function describePublishFailure(error: unknown): never {
  getLogger().error({ error: errorForLog(error) }, "signal publishing failed");
  throw error;
}
