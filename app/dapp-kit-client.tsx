"use client";

import { DAppKitProvider } from "@mysten/dapp-kit-react";
import type { ReactNode } from "react";

import { dAppKit } from "./dapp-kit";

/**
 * `createDAppKit` defers wallet discovery to `onMount` and falls back to an in-memory
 * storage when `localStorage` is unavailable, so it is safe to evaluate during SSR. This
 * wrapper therefore must not be loaded with `ssr: false`: doing that at the root layout
 * pushed every page in the app into client rendering.
 */
export function DAppKitClientProvider({ children }: { readonly children: ReactNode }) {
  return <DAppKitProvider dAppKit={dAppKit}>{children}</DAppKitProvider>;
}
