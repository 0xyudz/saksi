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

const publishedSignalSchema = z
  .object({
    signal: z
      .object({
        id: z.string(),
        title: z.string(),
        provider: z.string(),
        externalRef: z.string(),
        priceAtomic: z.string(),
        payToAddress: z.string().nullable(),
        createdAt: z.string(),
      })
      .loose(),
    listingFee: z
      .object({
        digest: z.string(),
        amountAtomic: z.string(),
        explorerUrl: z.string().url(),
      })
      .loose(),
  })
  .loose();

export type PublishedSignalResult = z.infer<typeof publishedSignalSchema>;

/**
 * Pays the platform's listing fee and publishes the signal in one round trip.
 *
 * The payment is a plain x402 `exact` settlement to a single recipient — the platform —
 * which is what makes it possible at all: Sui's gasless mode only permits
 * `balance::send_funds` and rejects every coin-splitting command, so a fee cannot be
 * carved out of the buyer's payment. Charging the seller separately keeps both payments
 * honest and keeps Saksi out of custody.
 *
 * The settlement can succeed while the listing does not: Tatum indexes a new transaction
 * a few seconds after it lands, and any other server-side failure has the same effect.
 * In that case the fee has already been taken, so the digest is recovered instead of
 * asking the seller to pay again.
 */
export async function publishSignalWithWallet(input: {
  readonly body: {
    readonly title: string;
    readonly externalRef: string;
    readonly priceAtomic: string;
    readonly payload: Record<string, unknown>;
  };
  readonly signer: ClientSuiSigner;
}): Promise<PublishedSignalResult> {
  const url = new URL("/api/signals", window.location.origin);
  const requestBody = JSON.stringify(input.body);

  const allowedAssets = await allowedAssetsFromChallenge(url, "POST", requestBody);
  const client = x402Client.fromConfig({
    schemes: [{ network: X402_NETWORK, client: new ExactSuiScheme(input.signer) }],
    spendControls: { allowedAssets: [...allowedAssets] },
  });
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);

  const response = await fetchWithPayment(url, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    credentials: "same-origin",
    body: requestBody,
  });

  if (!response.ok) {
    const settle = settleDigest(response);
    if (settle !== null) {
      const recovered = await recoverPublishedListing(settle, input.body);
      if (recovered !== null) return recovered;
    }
    throw new Error(await failureMessage(response));
  }

  const body: unknown = await response.json().catch(() => null);
  const parsed = publishedSignalSchema.safeParse(body);
  if (!parsed.success) throw new Error("The listing endpoint returned an unexpected body.");
  return parsed.data;
}

/** The settlement digest of a failed paid request, when the payment did settle. */
function settleDigest(response: Response): string | null {
  try {
    const settle = new x402HTTPClient(new x402Client()).getPaymentSettleResponse((name) =>
      response.headers.get(name),
    );
    if (settle.success && settle.transaction) return settle.transaction;
  } catch {
    // No settle header. Fall through: the server also reports the digest it settled, so a
    // failure after payment is still recoverable.
  }
  return response.headers.get("x-saksi-digest");
}

/**
 * Asks the server to finish a listing whose fee already settled.
 *
 * Returns null when the fee is genuinely unknown or already spent on another listing, so
 * the caller can surface the original failure rather than a recovery error.
 */
async function recoverPublishedListing(
  digest: string,
  body: {
    readonly title: string;
    readonly externalRef: string;
    readonly priceAtomic: string;
    readonly payload: Record<string, unknown>;
  },
): Promise<PublishedSignalResult | null> {
  try {
    const response = await fetch(new URL("/api/signals/recover", window.location.origin), {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ ...body, digest }),
    });
    if (!response.ok) return null;

    const parsed = publishedSignalSchema.safeParse(await response.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
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
 *
 * The challenge request must carry the same method, body and content type as the paid
 * request that follows. The route validates the body before it settles the fee, so a
 * preflight sent without it is answered 400 ("The listing payload is invalid.") instead of
 * 402, and the payment wrapper then has no challenge to satisfy.
 */
async function allowedAssetsFromChallenge(
  url: URL,
  method: "GET" | "POST" = "GET",
  requestBody?: string,
): Promise<readonly SpendControlAsset[]> {
  const response = await fetch(url, {
    method,
    headers:
      requestBody === undefined
        ? { accept: "application/json" }
        : { accept: "application/json", "content-type": "application/json" },
    credentials: "same-origin",
    ...(requestBody === undefined ? {} : { body: requestBody }),
  });

  if (response.status !== 402) {
    if (!response.ok) throw new Error(await failureMessage(response));
    throw new Error("The signal endpoint did not ask for an x402 payment.");
  }

  const challengeBody: unknown = await response.json().catch(() => null);
  const challenge = new x402HTTPClient(new x402Client()).getPaymentRequiredResponse(
    (name) => response.headers.get(name),
    challengeBody,
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
