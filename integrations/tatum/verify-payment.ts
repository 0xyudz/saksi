import { normalizeCoinType } from "@/lib/coin-type";
import { explorerTxUrl, SUI_DIGEST_PATTERN } from "@/lib/config";
import type { JsonObject } from "@/lib/domain";
import { getEnv, type SuiNetwork } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { nowIso } from "@/lib/time";
import { TatumSuiRpc, type SuiTransactionBlock } from "./rpc";

export interface VerifyPaymentInput {
  readonly digest: string;
  readonly payTo: string;
  readonly minAmountAtomic: bigint;
  readonly network: SuiNetwork;
  readonly coinType?: string;
}

export interface VerifiedPayment {
  readonly digest: string;
  readonly payer: string;
  readonly payTo: string;
  readonly amountAtomic: bigint;
  readonly network: SuiNetwork;
  readonly coinType: string;
  readonly verifiedAt: string;
  readonly explorerUrl: string;
  readonly raw: JsonObject;
}

export interface PaymentVerification {
  readonly payment: VerifiedPayment;
  readonly transaction: SuiTransactionBlock;
}

function addressOfOwner(owner: unknown): string | null {
  if (typeof owner !== "object" || owner === null) return null;
  const record = owner as Record<string, unknown>;
  if (typeof record.AddressOwner === "string") return record.AddressOwner;
  if (typeof record.ObjectOwner === "string") return record.ObjectOwner;
  if (typeof record.Immutable === "string") return record.Immutable;
  return null;
}

/**
 * Tatum is the authority: a signal is released only when the settlement digest exists
 * on the configured Sui network, succeeded, and paid the expected recipient in the
 * expected coin for at least the requested amount.
 */
export async function verifyPayment(
  input: VerifyPaymentInput,
  rpc: TatumSuiRpc = TatumSuiRpc.fromEnv(),
): Promise<PaymentVerification> {
  const env = getEnv();

  if (!SUI_DIGEST_PATTERN.test(input.digest)) {
    throw new AppError("VALIDATION_FAILED", "Invalid Sui transaction digest.");
  }
  if (input.network !== env.SUI_NETWORK) {
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      `Settlement network ${input.network} does not match the configured network.`,
    );
  }

  const coinType = normalizeCoinType(input.coinType ?? env.SUI_USDC_COIN_TYPE);
  const { result: block, raw } = await rpc.getTransactionBlock(input.digest, {
    showEffects: true,
    showEvents: true,
    showBalanceChanges: true,
    showInput: true,
  });

  if (block.digest !== input.digest) {
    throw new AppError("PAYMENT_NOT_VERIFIED", "Tatum returned a different transaction digest.");
  }

  const status = block.effects?.status.status;
  if (status !== "success") {
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      `Settlement transaction status is ${status ?? "unknown"}.`,
    );
  }

  const payer = block.transaction?.data.sender;
  if (!payer) {
    throw new AppError("PAYMENT_NOT_VERIFIED", "Settlement transaction has no sender.");
  }

  let paid = 0n;
  for (const change of block.balanceChanges ?? []) {
    const owner = addressOfOwner(change.owner);
    if (owner?.toLowerCase() !== input.payTo.toLowerCase()) continue;
    if (normalizeCoinType(change.coinType) !== coinType) continue;
    const amount = BigInt(change.amount);
    if (amount > 0n) paid += amount;
  }

  if (paid < input.minAmountAtomic) {
    throw new AppError(
      "PAYMENT_NOT_VERIFIED",
      `Settlement paid ${paid.toString()} atomic units, expected at least ${input.minAmountAtomic.toString()}.`,
    );
  }

  const verifiedAt = nowIso();

  return {
    payment: {
      digest: input.digest,
      payer,
      payTo: input.payTo,
      amountAtomic: paid,
      network: input.network,
      coinType,
      verifiedAt,
      explorerUrl: explorerTxUrl(input.network, input.digest),
      raw: {
        transaction: raw,
        verifiedAt,
        coinType,
      },
    },
    transaction: block,
  };
}
