import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db/client";
import { payments, type PaymentRow, type SignalRow } from "@/db/schema";
import { remember } from "@/integrations/walrus-memory/client";
import { buildPaymentMemory, buildSourceRoiMemory } from "@/integrations/walrus-memory/schema";
import { buySignal } from "@/integrations/x402/buyer";
import { verifyPayment, type VerifiedPayment } from "@/integrations/tatum/verify-payment";
import type { JsonObject } from "@/lib/domain";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { errorForLog, getLogger } from "@/lib/logger";
import { sourceRoi } from "@/server/data/payments";
import { assertSettlementMatchesSignal, isRetryablePaymentError } from "@/server/scoring/payment-binding";
import { getSignal } from "./ingest-signal";

const VERIFY_ATTEMPTS = 4;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function verifyPaymentWithRetry(
  input: Parameters<typeof verifyPayment>[0],
): Promise<VerifiedPayment> {
  let lastError: unknown;
  for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
    try {
      const result = await verifyPayment(input);
      return result.payment;
    } catch (error) {
      lastError = error;
      if (!isRetryablePaymentError(error)) throw error;
      if (attempt < VERIFY_ATTEMPTS - 1) {
        await sleep(500 * 2 ** attempt);
      }
    }
  }
  throw lastError instanceof AppError
    ? lastError
    : new AppError("PAYMENT_NOT_VERIFIED", "Tatum could not verify the settlement.", {
        cause: lastError,
      });
}

export interface RecordedPayment {
  readonly payment: PaymentRow;
  readonly created: boolean;
  /** True when this call newly attached a user to the audit row, so memory is owed. */
  readonly attributed: boolean;
}

/** Idempotent on the Sui digest, so retries never double-charge the audit trail. */
export async function recordPayment(input: {
  verified: VerifiedPayment;
  signalId: string;
  userId?: string;
  pickId?: string;
  resource?: string | null;
  requirements?: JsonObject;
}): Promise<RecordedPayment> {
  const db = getDb();
  const raw: JsonObject = input.verified.raw;

  const inserted = await db
    .insert(payments)
    .values({
      userId: input.userId ?? null,
      signalId: input.signalId,
      pickId: input.pickId ?? null,
      digest: input.verified.digest,
      resource: input.resource ?? null,
      requirements: input.requirements ?? null,
      payer: input.verified.payer,
      payTo: input.verified.payTo,
      amountAtomic: input.verified.amountAtomic,
      network: input.verified.network,
      verifiedAt: new Date(input.verified.verifiedAt),
      raw,
    })
    .onConflictDoNothing({ target: payments.digest })
    .returning();

  if (inserted[0]) {
    return {
      payment: inserted[0],
      created: true,
      attributed: input.userId !== undefined,
    };
  }

  const existing = await db
    .select()
    .from(payments)
    .where(eq(payments.digest, input.verified.digest))
    .limit(1);
  const payment = existing[0];
  if (!payment) {
    throw new AppError("INTERNAL", "A duplicate payment could not be read back.");
  }

  // A digest is a receipt for exactly one purchase. Never let an old settlement be
  // reported as a success for a different signal or resource.
  assertSettlementMatchesSignal({
    existingPayment: { signalId: payment.signalId, resource: payment.resource },
    requestedSignalId: input.signalId,
    expectedResource: input.resource ?? null,
  });

  // The seller records an external settlement before the internal buyer claims it.
  // Attaching the user once lets that buyer write payment/source-ROI memories.
  if (input.userId !== undefined && payment.userId === null) {
    const updated = await db
      .update(payments)
      .set({ userId: input.userId })
      .where(and(eq(payments.digest, input.verified.digest), isNull(payments.userId)))
      .returning();
    const claimed = updated[0];
    if (claimed) return { payment: claimed, created: false, attributed: true };
  }

  return { payment, created: false, attributed: false };
}

async function writePaymentMemories(userId: string, payment: PaymentRow): Promise<string[]> {
  const blobIds: string[] = [];
  try {
    const paymentWrite = await remember(
      userId,
      buildPaymentMemory({
        digest: payment.digest,
        provider: (await getSignal(payment.signalId)).provider,
        amountAtomic: payment.amountAtomic.toString(),
        network: payment.network,
      }),
    );
    blobIds.push(paymentWrite.blobId);
  } catch (error) {
    getLogger().warn(
      { error: errorForLog(error), digest: payment.digest },
      "payment memory write failed",
    );
  }

  try {
    const signal = await getSignal(payment.signalId);
    const stats = await sourceRoi(signal.provider, userId);
    const roiWrite = await remember(
      userId,
      buildSourceRoiMemory({
        provider: stats.provider,
        spendAtomic: stats.spendAtomic.toString(),
        correct: stats.correct,
        wrong: stats.wrong,
        note:
          stats.resolved === 0
            ? "Purchased before any linked pick resolved."
            : `Net hit rate ${(stats.roi * 100).toFixed(1)}% across ${stats.resolved} linked picks.`,
      }),
    );
    blobIds.push(roiWrite.blobId);
  } catch (error) {
    getLogger().warn(
      { error: errorForLog(error), digest: payment.digest },
      "source ROI memory write failed",
    );
  }

  return blobIds;
}

export interface PurchasedSignal {
  readonly signal: Awaited<ReturnType<typeof getSignal>>;
  readonly payment: PaymentRow;
  readonly digest: string;
  readonly payer: string | null;
  readonly explorerUrl: string;
  readonly memoryBlobIds: readonly string[];
}

export async function purchaseSignal(
  userId: string,
  signalId: string,
  pickId?: string,
): Promise<PurchasedSignal> {
  const env = getEnv();
  const signal = await getSignal(signalId);
  const purchase = await buySignal(signalId);

  if (purchase.body.signal.id !== signalId) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The paid endpoint returned the wrong signal.");
  }

  const verified = await verifyPaymentWithRetry({
    digest: purchase.digest,
    payTo: env.X402_PAY_TO_ADDRESS,
    minAmountAtomic: signal.priceAtomic,
    network: env.SUI_NETWORK,
  });

  const recorded = await recordPayment({
    verified,
    signalId,
    resource: `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/signals/${encodeURIComponent(signalId)}`,
    userId,
    ...(pickId === undefined ? {} : { pickId }),
  });

  const memoryBlobIds = recorded.attributed
    ? await writePaymentMemories(userId, recorded.payment)
    : [];

  return {
    signal,
    payment: recorded.payment,
    digest: verified.digest,
    payer: purchase.payer,
    explorerUrl: verified.explorerUrl,
    memoryBlobIds,
  };
}

export interface VerifiedSignalPayment {
  readonly signal: Awaited<ReturnType<typeof getSignal>>;
  readonly payment: PaymentRow;
  readonly digest: string;
  readonly explorerUrl: string;
  readonly coinType: string;
  readonly amountAtomic: string;
  readonly payer: string;
  readonly memoryBlobIds: readonly string[];
}

export async function verifyAndRecordSignalPayment(input: {
  signalId: string;
  digest: string;
  userId?: string;
  pickId?: string;
  resource?: string | null;
  requirements?: JsonObject;
  /** Pre-loaded by the route so an unknown signal is rejected before settlement. */
  signal?: SignalRow;
}): Promise<VerifiedSignalPayment> {
  const env = getEnv();
  const signal = input.signal ?? (await getSignal(input.signalId));
  const verified = await verifyPaymentWithRetry({
    digest: input.digest,
    payTo: env.X402_PAY_TO_ADDRESS,
    minAmountAtomic: signal.priceAtomic,
    network: env.SUI_NETWORK,
  });

  const recorded = await recordPayment({
    verified,
    signalId: input.signalId,
    ...(input.userId === undefined ? {} : { userId: input.userId }),
    ...(input.pickId === undefined ? {} : { pickId: input.pickId }),
    ...(input.resource === undefined ? {} : { resource: input.resource }),
    ...(input.requirements === undefined ? {} : { requirements: input.requirements }),
  });

  const memoryBlobIds =
    recorded.attributed && input.userId
      ? await writePaymentMemories(input.userId, recorded.payment)
      : [];

  return {
    signal,
    payment: recorded.payment,
    digest: verified.digest,
    explorerUrl: verified.explorerUrl,
    coinType: verified.coinType,
    amountAtomic: verified.amountAtomic.toString(),
    payer: verified.payer,
    memoryBlobIds,
  };
}
