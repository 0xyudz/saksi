import { createDAppKit } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";

/**
 * Wallet connection lives in the browser. The gRPC endpoint is only used to build
 * transactions that the user signs; all server-side reads still go through Tatum.
 */
const GRPC_URLS = {
  mainnet: "https://fullnode.mainnet.sui.io:443",
} as const;

export type SaksiNetwork = keyof typeof GRPC_URLS;

export const SAKSI_NETWORK: SaksiNetwork = "mainnet";

export const dAppKit = createDAppKit({
  networks: [SAKSI_NETWORK],
  defaultNetwork: SAKSI_NETWORK,
  createClient: (network) => new SuiGrpcClient({ network, baseUrl: GRPC_URLS[network] }),
});

declare module "@mysten/dapp-kit-react" {
  interface Register {
    dAppKit: typeof dAppKit;
  }
}
