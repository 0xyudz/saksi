import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RouteConfig } from "@x402/core/server";
import type { PaymentFlowConfig, PaymentRequirements, SchemeNetworkServer } from "@x402/core/types";
import { NextAdapter, x402HTTPResourceServer, x402ResourceServer } from "@x402/next";
import { ExactSuiScheme } from "@tentaclepay/sui-x402/exact/server";
import type { NextRequest } from "next/server";
import type { HTTPProcessResult, ProcessSettleSuccessResponse } from "@x402/core/server";

import { USDC_DECIMALS } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getLogger, errorForLog } from "@/lib/logger";
import { formatUsd, parsePriceToAtomic } from "@/lib/price";
import { findListingForPayment, type ListingPaymentTarget } from "@/server/data/listings";

export const SIGNAL_ROUTE_PATTERN = "GET /api/signals/[id]";
export const LISTING_ROUTE_PATTERN = "POST /api/signals";

/**
 * `@tentaclepay/sui-x402` is built against the pre-ATM x402 core interface. The Sui
 * exact scheme is an authorization-style payment: Tatum-verified settlement happens
 * after the handler, so the adapter declares that flow for the newer core.
 */
class SuiSchemeServerAdapter implements SchemeNetworkServer {
  readonly scheme = "exact";
  readonly defaultAssetTransferMethod = "default";
  readonly paymentFlows: Readonly<Record<string, PaymentFlowConfig>> = {
    default: { supported: ["authorization"], default: "authorization" },
  };

  constructor(private readonly inner: ExactSuiScheme) {}

  parsePrice(
    ...args: Parameters<SchemeNetworkServer["parsePrice"]>
  ): ReturnType<SchemeNetworkServer["parsePrice"]> {
    return this.inner.parsePrice(...args);
  }

  enhancePaymentRequirements(
    ...args: Parameters<SchemeNetworkServer["enhancePaymentRequirements"]>
  ): ReturnType<SchemeNetworkServer["enhancePaymentRequirements"]> {
    return this.inner.enhancePaymentRequirements(...args);
  }

  getAssetDecimals(): number {
    return USDC_DECIMALS;
  }
}

/**
 * The signal route is the only one whose recipient and amount vary per request.
 *
 * Buyers pay the seller's proven wallet directly, so `payTo` is resolved from the signal
 * being purchased rather than from configuration. A missing or unlisted signal resolves
 * to the platform address so the 402 challenge is still well formed; the handler rejects
 * the request before any settlement is attempted.
 *
 * The amount is resolved from the same row, so a seller-set price cannot drift from what
 * the challenge advertises and what Tatum later verifies.
 */
async function resolveSignalTerms(signalId: string): Promise<ListingPaymentTarget> {
  const listing = await findListingForPayment(signalId);
  if (listing) return listing;

  const env = getEnv();
  return {
    payToAddress: env.X402_PAY_TO_ADDRESS,
    priceAtomic: parsePriceToAtomic(env.X402_PRICE),
  };
}

function signalIdFromPath(path: string): string | null {
  const match = /\/api\/signals\/([^/?#]+)/.exec(path);
  if (!match?.[1]) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function buildRoutes(): Record<string, RouteConfig> {
  const env = getEnv();
  const signalPrice = formatUsd(parsePriceToAtomic(env.X402_PRICE));
  const listingFee = formatUsd(parsePriceToAtomic(env.X402_LISTING_FEE));

  return {
    [SIGNAL_ROUTE_PATTERN]: {
      accepts: [
        {
          scheme: "exact",
          // Both values are resolved per request. The x402 scheme parses `price` as a
          // human USD string, so atomic configuration is normalised first.
          price: async (context) => {
            const signalId = signalIdFromPath(context.path || context.adapter.getPath());
            if (signalId === null) return signalPrice;
            const terms = await resolveSignalTerms(signalId);
            return formatUsd(terms.priceAtomic);
          },
          network: env.SUI_NETWORK,
          payTo: async (context) => {
            const signalId = signalIdFromPath(context.path || context.adapter.getPath());
            if (signalId === null) return env.X402_PAY_TO_ADDRESS;
            const terms = await resolveSignalTerms(signalId);
            return terms.payToAddress;
          },
        },
      ],
      description: "Saksi premium prediction signal, settled on Sui through x402",
      mimeType: "application/json",
    },
    /**
     * Publishing a signal costs a flat listing fee paid to the platform. This is the only
     * revenue Saksi takes, and it is enforceable because a listing stays invisible until
     * its fee is verified. It is deliberately not a percentage of sales: x402 `exact`
     * pays one recipient per transaction, and Sui's gasless mode only permits
     * `balance::send_funds`, so a split inside one settlement is not possible.
     */
    [LISTING_ROUTE_PATTERN]: {
      accepts: [
        {
          scheme: "exact",
          price: listingFee,
          network: env.SUI_NETWORK,
          payTo: env.X402_PAY_TO_ADDRESS,
        },
      ],
      description: "Saksi signal listing fee",
      mimeType: "application/json",
    },
  };
}

let serverPromise: Promise<x402HTTPResourceServer> | undefined;

async function createServer(): Promise<x402HTTPResourceServer> {
  const env = getEnv();
  const facilitator = new HTTPFacilitatorClient({ url: env.X402_FACILITATOR_URL });
  const resourceServer = new x402ResourceServer(facilitator).register(
    env.SUI_NETWORK,
    new SuiSchemeServerAdapter(new ExactSuiScheme()),
  );
  const httpServer = new x402HTTPResourceServer(resourceServer, buildRoutes());
  await httpServer.initialize();
  return httpServer;
}

export function getSellerServer(): Promise<x402HTTPResourceServer> {
  if (!serverPromise) {
    serverPromise = createServer().catch((error: unknown) => {
      serverPromise = undefined;
      getLogger().error(
        { error: errorForLog(error) },
        "x402 seller failed to initialize with the facilitator",
      );
      throw new AppError("UPSTREAM_UNAVAILABLE", "The x402 facilitator is not reachable.", {
        cause: error,
      });
    });
  }
  return serverPromise;
}

export type SellerAuthorization =
  | {
      readonly kind: "payment-required";
      readonly result: Extract<HTTPProcessResult, { type: "payment-error" }>;
    }
  | {
      readonly kind: "settled";
      readonly settlement: ProcessSettleSuccessResponse;
      readonly payment: { readonly payer?: string };
      /** The x402 resource the buyer actually paid for. */
      readonly resource: string;
      /** The requirements the facilitator authorized for this settlement. */
      readonly paymentRequirements: PaymentRequirements;
    };

export async function authorizePayment(request: NextRequest): Promise<SellerAuthorization> {
  const server = await getSellerServer();
  const adapter = new NextAdapter(request);
  const url = new URL(request.url);
  const context = {
    adapter,
    path: url.pathname,
    method: request.method,
    paymentHeader:
      request.headers.get("PAYMENT-SIGNATURE") ?? request.headers.get("X-PAYMENT") ?? undefined,
  };

  const processed = await server.processHTTPRequest(context);
  if (processed.type === "payment-error") {
    return { kind: "payment-required", result: processed };
  }
  if (processed.type === "no-payment-required") {
    throw new AppError("INTERNAL", "A protected signal route was reached without a paywall.");
  }

  const settlement = await server.processSettlement(
    processed.paymentPayload,
    processed.paymentRequirements,
    processed.declaredExtensions,
    { request: context },
    undefined,
    processed.beforeHandlerSettlement,
  );

  if (!settlement.success) {
    return {
      kind: "payment-required",
      result: { type: "payment-error", response: settlement.response },
    };
  }

  return {
    kind: "settled",
    settlement,
    payment: settlement.payer === undefined ? {} : { payer: settlement.payer },
    // x402 v2 carries the resource on the payment payload; fall back to the request
    // URL because the seller route is the resource being purchased.
    resource: processed.paymentPayload.resource?.url ?? request.url,
    paymentRequirements: processed.paymentRequirements,
  };
}
