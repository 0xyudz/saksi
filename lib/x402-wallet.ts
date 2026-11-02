import type { ClientSuiSigner } from "@tentaclepay/sui-x402";
import { ExactSuiScheme } from "@tentaclepay/sui-x402/exact/client";
import type { SpendControlAsset } from "@x402/core/client";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { wrapFetchWithPayment } from "@x402/fetch";
import { z } from "zod";

/**
 * Browser-side x402 purchase. The server advertises the requirements; the connected
 * wallet signs the Sui transaction, and the facilitator settles it before the seller
 * releases the signal. No private key ever reaches the client.
 */

const X402_NETWORK = "sui:mainnet" as const;

const paidSignalSchema = z
  .object({
    signal: z
      .object({
        id: z.string(),
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
        coinType: z.string(),
        amountAtomic: z.string(),
      })
      .loose(),
    memory: z.object({ blobIds: z.array(z.string()) }).loose(),
  })
  .loose();

export type PaidSignalResponse = z.infer<typeof paidSignalSchema>;

export interface WalletPaymentResult {
  readonly signal: PaidSignalResponse["signal"];
  readonly digest: string;
  readonly payer: string | null;
  readonly network: string;
  readonly explorerUrl: string;
  readonly amountAtomic: string;
  readonly memoryBlobIds: readonly string[];
}

async function failureMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  if (text.length > 0) {
    try {
      const parsed = z
        .object({ error: z.object({ message: z.string() }).loose() })
        .loose()
        .safeParse(JSON.parse(text));
      if (parsed.success) return parsed.data.error.message;
    } catch {
      // The body was not JSON; fall through to the status line.
    }
  }
  return `The x402 endpoint responded ${response.status}.`;
}

/**
 * The seller advertises the asset it accepts (Sui USDC). `@x402/core` rejects any
 * non-default asset unless it is listed in `spendControls.allowedAssets`, so read the
 * challenge first and allow exactly the network, asset and amount the seller asked for.
 */
async function allowedAssetsFromChallenge(url: URL): Promise<readonly SpendControlAsset[]> {
  const response = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });

  if (response.status !== 402) {
    if (!response.ok) throw new Error(await failureMessage(response));
    throw new Error("The signal endpoint did not ask for an x402 payment.");
  }

  const body: unknown = await response.json().catch(() => null);
  const challenge = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(
    (name) => response.headers.get(name),
    body,
  );

  const assets = challenge.accepts
    .filter((requirement) => requirement.network === X402_NETWORK)
    .map((requirement) => ({
      network: requirement.network,
      asset: requirement.asset,
      maxAmountPerPayment: requirement.amount,
    }));

  if (assets.length === 0) {
    throw new Error(`The seller does not accept a ${X402_NETWORK} payment.`);
  }

  return assets;
}

export async function buySignalWithWallet(input: {
  readonly signalId: string;
  readonly pickId?: string;
  readonly signer: ClientSuiSigner;
}): Promise<WalletPaymentResult> {
  const url = new URL(`/api/signals/${encodeURIComponent(input.signalId)}`, window.location.origin);
  if (input.pickId !== undefined && input.pickId.length > 0) {
    url.searchParams.set("pickId", input.pickId);
  }

  const allowedAssets = await allowedAssetsFromChallenge(url);
  const client = x402Client.fromConfig({
    schemes: [{ network: X402_NETWORK, client: new ExactSuiScheme(input.signer) }],
    spendControls: { allowedAssets: [...allowedAssets] },
  });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(url, {
    method: "GET",
    headers: { accept: "application/json" },
    credentials: "same-origin",
  });

  if (!response.ok) throw new Error(await failureMessage(response));

  let settle;
  try {
    settle = new x402HTTPClient(client).getPaymentSettleResponse((name) =>
      response.headers.get(name),
    );
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `The settlement receipt is missing: ${error.message}`
        : "The settlement receipt is missing.",
    );
  }

  if (!settle.success || !settle.transaction) {
    throw new Error("The x402 settlement was not successful.");
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = paidSignalSchema.safeParse(body);
  if (!parsed.success) throw new Error("The paid endpoint returned an unexpected body.");

  return {
    signal: parsed.data.signal,
    digest: settle.transaction,
    payer: settle.payer ?? parsed.data.settlement.payer,
    network: settle.network,
    explorerUrl: parsed.data.settlement.explorerUrl,
    amountAtomic: parsed.data.settlement.amountAtomic,
    memoryBlobIds: parsed.data.memory.blobIds,
  };
}
