"use client";

import type { ReactNode } from "react";

import { DAppKitClientProvider } from "./dapp-kit-client";

/**
 * Rendered from the root layout. The wallet provider used to be loaded through
 * `next/dynamic` with `ssr: false`, which made Next.js bail out of server rendering for
 * every route and serve an empty shell instead of HTML. The provider is SSR-safe, so it is
 * imported normally and the app keeps its server-rendered markup.
 */
export function Providers({ children }: { readonly children: ReactNode }) {
  return <DAppKitClientProvider>{children}</DAppKitClientProvider>;
}
