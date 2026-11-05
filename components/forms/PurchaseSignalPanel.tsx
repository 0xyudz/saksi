"use client";

import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { WalletMenu } from "@/components/WalletMenu";
import { shortHash } from "@/lib/format";
import { buySignalWithWallet, type WalletPaymentResult } from "@/lib/x402-wallet";

export interface PurchasePickOption {
  readonly id: string;
  readonly label: string;
}

export function PurchaseSignalPanel({
  signalId,
  payToAddress,
  pickOptions,
}: {
  readonly signalId: string;
  /** The seller's wallet, which is where this payment goes. */
  readonly payToAddress: string | null;
  readonly pickOptions: readonly PurchasePickOption[];
}) {
  const router = useRouter();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const [pickId, setPickId] = useState("");
  const [result, setResult] = useState<WalletPaymentResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function purchase() {
    if (!account) {
      setError("Connect a Sui wallet before paying.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const paid = await buySignalWithWallet({
        signalId,
        ...(pickId.length === 0 ? {} : { pickId }),
        signer: {
          address: account.address as `0x${string}`,
          signTransaction: async (bytes) => {
            const { signature } = await dAppKit.signTransaction({
              transaction: bytes,
              network: "mainnet",
            });
            return signature;
          },
        },
      });
      setResult(paid);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Purchase failed.");
    } finally {
      setPending(false);
    }
  }

  if (!account) {
    return (
      <div className="border-amber/30 bg-amber/5 text-amber space-y-3 rounded-xl border p-4 text-sm leading-relaxed">
        <p>
          Connect a Sui wallet to pay from your own balance. The payment is signed in your wallet;
          Saksi never receives your private key.
        </p>
        <WalletMenu />
      </div>
    );
  }

  /*
   * Paying your own wallet settles on chain but moves nothing, so the verifier would see a
   * payment of zero and refuse to release the payload. Say so before the wallet prompt
   * appears instead of letting the buyer sign a transaction that cannot succeed.
   */
  if (payToAddress !== null && account.address.toLowerCase() === payToAddress.toLowerCase()) {
    return (
      <div className="border-amber/30 bg-amber/5 text-amber space-y-3 rounded-xl border p-4 text-sm leading-relaxed">
        <p className="mono text-[11px] break-all">paying from {account.address}</p>
        <p>
          This listing pays the wallet you are connected with, so buying it would move no funds and
          the settlement would verify as zero. Disconnect and buy with a different wallet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="mono text-muted text-[11px] break-all">paying from {account.address}</p>

      {pickOptions.length > 0 ? (
        <div>
          <label className="label" htmlFor="purchase-pick">
            Link to a pick <span className="normal-case">(optional)</span>
          </label>
          <select
            id="purchase-pick"
            className="select"
            value={pickId}
            onChange={(event) => setPickId(event.target.value)}
          >
            <option value="">Do not link</option>
            {pickOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <button type="button" className="btn btn-primary" onClick={purchase} disabled={pending}>
        {pending ? "Signing & verifying on Sui…" : "Pay with my wallet"}
      </button>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="card p-4">
          <p className="mono text-green text-[10px] tracking-[0.18em] uppercase">
            Tatum verified settlement
          </p>
          <p className="text-paper mt-2 text-sm">{result.signal.title}</p>
          <pre className="text-paper/80 mt-3 max-h-72 overflow-auto rounded-lg bg-black/40 p-3 font-mono text-[10px] leading-relaxed">
            {JSON.stringify(result.signal.payload, null, 2)}
          </pre>
          <div className="border-line text-muted mt-3 space-y-1 border-t pt-3 text-[11px]">
            <p className="mono break-all">digest {result.digest}</p>
            <p className="mono">payer {result.payer ?? "unknown"}</p>
            <p className="mono">amount {result.amountAtomic} atomic</p>
            {result.memoryBlobIds.length > 0 ? (
              <p className="mono">memory {shortHash(result.memoryBlobIds[0] ?? "", 12, 10)}</p>
            ) : null}
            <a
              href={result.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="link-underline text-amber inline-block"
            >
              Open settlement on explorer →
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}
