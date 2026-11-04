"use client";

import { useDAppKit, useWalletConnection, useWallets } from "@mysten/dapp-kit-react";
import { useState, useSyncExternalStore } from "react";

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * A store that never changes, used only to ask React whether hydration has finished.
 * `getServerSnapshot` returns false, so the server and the first client render agree;
 * after hydration React re-reads `getSnapshot` and returns true.
 */
const subscribeToNothing = (): (() => void) => () => {};
const getHydratedSnapshot = (): boolean => true;
const getServerHydratedSnapshot = (): boolean => false;

export function WalletMenu() {
  const dAppKit = useDAppKit();
  const wallets = useWallets();
  const connection = useWalletConnection();
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Wallet detection only exists in the browser: the server always sees zero wallets and a
   * disconnected account, while a browser with an extension sees the wallet on its first
   * render. That difference is a hydration mismatch on every app page for every wallet user.
   * Rendering a stable placeholder until hydration completes keeps the first client render
   * identical to the server's, then swaps in the real wallet state.
   */
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    getHydratedSnapshot,
    getServerHydratedSnapshot,
  );

  async function connect() {
    const wallet = wallets.find((item) => item.name === selected) ?? wallets[0];
    if (!wallet) return;

    setPending(true);
    setError(null);
    try {
      await dAppKit.connectWallet({ wallet });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not connect the wallet.");
    } finally {
      setPending(false);
    }
  }

  async function disconnect() {
    setPending(true);
    setError(null);
    try {
      await dAppKit.disconnectWallet();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not disconnect the wallet.");
    } finally {
      setPending(false);
    }
  }

  if (!hydrated) {
    return (
      <button type="button" className="btn btn-primary h-9 px-3 text-xs" disabled>
        Connect wallet
      </button>
    );
  }

  if (connection.isConnected) {
    return (
      <div className="flex items-center gap-2">
        <span
          className="mono text-muted hidden text-xs sm:inline"
          title={connection.account.address}
        >
          {shortAddress(connection.account.address)}
        </span>
        <button
          type="button"
          className="btn btn-ghost h-9 px-3 text-xs"
          onClick={disconnect}
          disabled={pending}
        >
          {pending ? "…" : "Disconnect"}
        </button>
        {error ? <span className="text-red text-[10px]">{error}</span> : null}
      </div>
    );
  }

  if (wallets.length === 0) {
    return (
      <span className="mono text-muted hidden text-[10px] sm:inline" title="Install a Sui wallet">
        No Sui wallet
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        {wallets.length > 1 ? (
          <select
            aria-label="Sui wallet"
            className="select h-9 w-28 px-2 text-xs"
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {wallets.map((wallet) => (
              <option key={wallet.name} value={wallet.name}>
                {wallet.name}
              </option>
            ))}
          </select>
        ) : null}
        <button
          type="button"
          className="btn btn-primary h-9 px-3 text-xs"
          onClick={connect}
          disabled={pending}
        >
          {pending ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
      {error ? <span className="text-red text-[10px]">{error}</span> : null}
    </div>
  );
}
