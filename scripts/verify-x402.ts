import "./load-env";

import { verifyPayment } from "@/integrations/tatum/verify-payment";
import { buySignal } from "@/integrations/x402/buyer";
import { getEnv } from "@/lib/env";
import { findListingForPayment } from "@/server/data/listings";

function output(value: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

/**
 * Requires the app to be running at APP_BASE_URL. The script pays the real paywalled
 * endpoint with X402_CLIENT_PRIVATE_KEY, then re-verifies the returned digest through
 * Tatum. The endpoint itself performs the seller-side verification before releasing data.
 *
 * The expected recipient is read from the signal row, not from configuration: a seller
 * listing pays the seller's own wallet, so checking against the platform address would
 * report a false failure for every signal the marketplace produced.
 */
async function main(): Promise<void> {
  const env = getEnv();
  if (!env.X402_TEST_SIGNAL_ID) {
    throw new Error(
      "X402_TEST_SIGNAL_ID is not set. Publish a listing and set its id to run this check.",
    );
  }

  const listing = await findListingForPayment(env.X402_TEST_SIGNAL_ID);
  const expectedPayTo = listing?.payToAddress ?? env.X402_PAY_TO_ADDRESS;

  const purchase = await buySignal(env.X402_TEST_SIGNAL_ID);
  if (purchase.body.signal.id !== env.X402_TEST_SIGNAL_ID) {
    throw new Error("The paid endpoint returned a different signal id.");
  }

  output({
    step: "purchase",
    signalId: purchase.body.signal.id,
    title: purchase.body.signal.title,
    digest: purchase.digest,
    payer: purchase.payer ?? "unavailable",
    network: purchase.network,
  });

  const verified = await verifyPayment({
    digest: purchase.digest,
    payTo: expectedPayTo,
    minAmountAtomic: BigInt(purchase.body.signal.priceAtomic),
    network: env.SUI_NETWORK,
  });

  output({
    step: "tatum-verification",
    digest: verified.payment.digest,
    payer: verified.payment.payer,
    payTo: verified.payment.payTo,
    amountAtomic: verified.payment.amountAtomic.toString(),
    coinType: verified.payment.coinType,
    explorerUrl: verified.payment.explorerUrl,
  });
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })}\n`,
  );
  process.exitCode = 1;
});
