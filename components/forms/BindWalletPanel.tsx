"use client";

import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { WalletMenu } from "@/components/WalletMenu";
import { requestJson } from "@/lib/client-api";

const challengeSchema = z
  .object({
    challenge: z.object({ nonce: z.string(), address: z.string(), message: z.string() }).loose(),
  })
  .loose();

const bindSchema = z
  .object({ user: z.object({ walletAddress: z.string().nullable() }).loose() })
  .loose();

/**
 * Binds a wallet to the signed-in journal.
 *
 * This path exists for journals created before wallet auth: their handles are already
 * taken and cannot be re-created, so they need a way to gain a payout address. It is
 * one-way on purpose — rebinding is refused server-side, because silently repointing
 * where buyers pay would redirect a seller's income from a hijacked session.
 */
export function BindWalletPanel() {
  const router = useRouter();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function bind() {
    if (!account) {
      setError("Connect a Sui wallet first.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const challenge = await requestJson({
        url: "/api/session",
        method: "PUT",
        body: { address: account.address, purpose: "bind" },
        schema: challengeSchema,
      });

      const signed = await dAppKit.signPersonalMessage({
        message: new TextEncoder().encode(challenge.challenge.message),
        network: "mainnet",
      });

      await requestJson({
        url: "/api/session/wallet/bind",
        method: "POST",
        body: {
          address: challenge.challenge.address,
          nonce: challenge.challenge.nonce,
          signature: signed.signature,
        },
        schema: bindSchema,
      });

      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not bind that wallet.");
    } finally {
      setPending(false);
    }
  }

  if (!account) {
    return (
      <div className="space-y-3">
        <p className="text-muted text-xs leading-relaxed">
          Connect the wallet you want to be paid at. Saksi asks for one signature over a message it
          issued; nothing is transferred.
        </p>
        <WalletMenu />
        {error ? (
          <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="border-green/30 bg-green/5 text-green mono rounded-xl border px-3 py-2 text-[11px] break-all">
        {account.address}
      </p>

      <p className="text-muted text-xs leading-relaxed">
        Once bound, this address cannot be changed. Buyers will pay this wallet directly, so make
        sure you control it.
      </p>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={bind}>
        {pending ? "Waiting for your signature…" : "Sign & bind this wallet"}
      </button>
    </div>
  );
}
