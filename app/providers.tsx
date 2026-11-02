"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";

// Wallet detection reads `window`, so the provider must not render on the server.
const DAppKitClientProvider = dynamic(
  () => import("./dapp-kit-client").then((module) => module.DAppKitClientProvider),
  { ssr: false },
);

export function Providers({ children }: { readonly children: ReactNode }) {
  return <DAppKitClientProvider>{children}</DAppKitClientProvider>;
}
