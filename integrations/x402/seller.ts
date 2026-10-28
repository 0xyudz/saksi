import { HTTPFacilitatorClient } from "@x402/core/server";
import type { RouteConfig } from "@x402/core/server";
import type {
  PaymentFlowConfig,
  PaymentRequirements,
  SchemeNetworkServer,
} from "@x402/core/types";
import { NextAdapter, x402HTTPResourceServer, x402ResourceServer } from "@x402/next";
import { ExactSuiScheme } from "@tentaclepay/sui-x402/exact/server";
import type { NextRequest } from "next/server";
import type { HTTPProcessResult, ProcessSettleSuccessResponse } from "@x402/core/server";

import { USDC_DECIMALS } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { getLogger, errorForLog } from "@/lib/logger";

export const SIGNAL_ROUTE_PATTERN = "GET /api/signals/[id]";

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

function buildRoutes(): Record<string, RouteConfig> {
  const env = getEnv();
  return {
    [SIGNAL_ROUTE_PATTERN]: {
      accepts: [
        {
          scheme: "exact",
          price: env.X402_PRICE,
          network: env.SUI_NETWORK,
          payTo: env.X402_PAY_TO_ADDRESS,
        },
      ],
      description: "Saksi premium prediction signal, settled on Sui through x402",
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
