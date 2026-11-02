import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

import { APP_NAME } from "@/lib/config";

/**
 * Wallet connection lives in the browser. The gRPC endpoint is only used to build
 * transactions that the user signs; all server-side reads still go through Tatum.
 */
const GRPC_URLS = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
} as const;

export type SaksiNetwork = keyof typeof GRPC_URLS;

export const SAKSI_NETWORK: SaksiNetwork = "mainnet";

/**
 * `createDAppKit` runs wallet initializers immediately, including the Slush web wallet.
 * That initializer reads `document.title` and fetches wallet metadata, neither of which
 * exists on the server, so it is only registered in the browser. Passing `null` keeps the
 * server free of a DOM reference and of a pointless outbound request; the browser keeps a
 * named app so the Slush prompt is labelled correctly.
 */
const SLUSH_CONFIG = typeof window === "undefined" ? null : { appName: APP_NAME };

export const dAppKit = createDAppKit({
  networks: [SAKSI_NETWORK],
  defaultNetwork: SAKSI_NETWORK,
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
  slushWalletConfig: SLUSH_CONFIG,
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
