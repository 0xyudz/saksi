import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { fromBase64 } from "@mysten/sui/utils";
import { ExactSuiScheme } from "@tentaclepay/sui-x402/exact/client";
import type { ClientSuiSigner } from "@tentaclepay/sui-x402";
import { z } from "zod";

import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

const signalResponseSchema = z
  .object({
    signal: z
      .object({
        id: z.string().uuid(),
        provider: z.string(),
        title: z.string(),
        payload: z.unknown(),
        priceAtomic: z.string(),
        asset: z.string(),
        createdAt: z.string(),
      })
      .loose(),
    settlement: z
      .object({
        digest: z.string(),
        payer: z.string().nullable(),
        explorerUrl: z.string().url(),
        verifiedBy: z.literal("tatum"),
      })
      .loose(),
  })
  .loose();

export type PaidSignalResponse = z.infer<typeof signalResponseSchema>;

export interface PurchasedSignal {
  readonly body: PaidSignalResponse;
  readonly digest: string;
  readonly payer: string | null;
  readonly network: string;
}

interface BuyerState {
  readonly client: x402Client;
  readonly fetchWithPayment: ReturnType<typeof wrapFetchWithPayment>;
}

let state: BuyerState | undefined;

function signerFromEnv(): ClientSuiSigner {
  const env = getEnv();
  const keypair = Ed25519Keypair.fromSecretKey(env.X402_CLIENT_PRIVATE_KEY);
  return {
    address: keypair.toSuiAddress() as `0x${string}`,
    signTransaction: async (bytes: string) => {
      const { signature } = await keypair.signTransaction(fromBase64(bytes));
      return signature;
    },
  };
}

function getBuyer(): BuyerState {
  if (state) return state;

  const env = getEnv();
  const client = new x402Client().register(env.SUI_NETWORK, new ExactSuiScheme(signerFromEnv()));
  state = { client, fetchWithPayment: wrapFetchWithPayment(fetch, client) };
  return state;
}

/**
 * Calls the paywalled endpoint with the agent wallet. The settle receipt is read from
 * the PAYMENT-RESPONSE header; the caller still re-verifies it through Tatum before
 * persisting anything.
 */
export async function buySignal(signalId: string): Promise<PurchasedSignal> {
  const env = getEnv();
  const { client, fetchWithPayment } = getBuyer();
  const url = `${env.APP_BASE_URL.replace(/\/+$/, "")}/api/signals/${encodeURIComponent(signalId)}`;

  let response: Response;
  try {
    response = await fetchWithPayment(url, {
      method: "GET",
      headers: { accept: "application/json" },
    });
  } catch (error) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The x402 purchase request failed.", {
      cause: error,
    });
  }

  if (!response.ok) {
    const text = await response.text();
    throw new AppError(
      response.status === 402 ? "PAYMENT_REQUIRED" : "UPSTREAM_UNAVAILABLE",
      `The x402 signal endpoint responded ${response.status}.`,
      { cause: new Error(text.slice(0, 500)) },
    );
  }

  const httpClient = new x402HTTPClient(client);
  let settle;
  try {
    settle = httpClient.getPaymentSettleResponse((name) => response.headers.get(name));
  } catch (error) {
    throw new AppError("PAYMENT_NOT_VERIFIED", "The x402 settlement receipt is missing.", {
      cause: error,
    });
  }

  if (!settle.success || !settle.transaction) {
    throw new AppError("PAYMENT_NOT_VERIFIED", "The x402 settlement was not successful.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The paid endpoint returned invalid JSON.", {
      cause: error,
    });
  }

  const parsed = signalResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError("UPSTREAM_UNAVAILABLE", "The paid endpoint returned an unexpected body.", {
      cause: parsed.error,
    });
  }

  return {
    body: parsed.data,
    digest: settle.transaction,
    payer: settle.payer ?? parsed.data.settlement.payer,
    network: settle.network,
  };
}
