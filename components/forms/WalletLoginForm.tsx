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

const loginSchema = z
  .object({ user: z.object({ id: z.string(), handle: z.string() }).loose() })
  .loose();

/**
 * Signs a returning seller back in with the wallet already bound to their journal.
 *
 * No handle is typed here on purpose: the address identifies exactly one journal because
 * `users.wallet_address` is unique, so proving the wallet is the whole credential. The
 * signature is over a `login` challenge, which cannot be replayed as a claim or a bind
 * because the purpose is part of the signed text.
 */
export function WalletLoginForm() {
  const router = useRouter();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function signIn() {
    if (!account) {
      setError("Connect the wallet bound to your journal first.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const challenge = await requestJson({
        url: "/api/session",
        method: "PUT",
        body: { address: account.address, purpose: "login" },
        schema: challengeSchema,
      });

      const signed = await dAppKit.signPersonalMessage({
        message: new TextEncoder().encode(challenge.challenge.message),
        network: "mainnet",
      });

      await requestJson({
        url: "/api/session/wallet",
        method: "POST",
        body: {
          address: challenge.challenge.address,
          nonce: challenge.challenge.nonce,
          signature: signed.signature,
        },
        schema: loginSchema,
      });

      router.push("/picks");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not sign in with that wallet.");
    } finally {
      setPending(false);
    }
  }

  if (!account) {
    return (
      <div className="space-y-3">
        <p className="text-muted text-xs leading-relaxed">
          Connect the wallet you bound to your journal. Saksi will ask for one signature; it
          authorises no payment.
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

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="button" className="btn btn-primary w-full" disabled={pending} onClick={signIn}>
        {pending ? "Waiting for your signature…" : "Sign in with this wallet"}
      </button>
    </div>
  );
}
