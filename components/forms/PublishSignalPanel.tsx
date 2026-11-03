"use client";

import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { WalletMenu } from "@/components/WalletMenu";
import { publishSignalWithWallet, type PublishedSignalResult } from "@/lib/x402-wallet";

export function PublishSignalPanel({ handle }: { readonly handle: string }) {
  const router = useRouter();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [title, setTitle] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [price, setPrice] = useState("0.05");
  const [body, setBody] = useState(
    '{\n  "note": "Synthetic demo payload written by the seller."\n}',
  );
  const [result, setResult] = useState<PublishedSignalResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) {
      setError("Connect a Sui wallet before paying the listing fee.");
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      setError("The payload must be valid JSON.");
      return;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
      setError("The payload must be a JSON object.");
      return;
    }

    setPending(true);
    setError(null);
    setResult(null);
    try {
      const published = await publishSignalWithWallet({
        body: {
          title: title.trim(),
          externalRef: externalRef.trim(),
          priceAtomic: price.trim(),
          payload: payload as Record<string, unknown>,
        },
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
      setResult(published);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publishing failed.");
    } finally {
      setPending(false);
    }
  }

  if (!account) {
    return (
      <div className="border-amber/30 bg-amber/5 text-amber space-y-3 rounded-xl border p-4 text-sm leading-relaxed">
        <p>
          Connect the wallet bound to <span className="mono">{handle}</span>. The listing fee is
          signed in your wallet; Saksi never sees your private key.
        </p>
        <WalletMenu />
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label className="label" htmlFor="publish-title">
          Title
        </label>
        <input
          id="publish-title"
          className="input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Premier League match winner, matchweek 11"
          minLength={4}
          maxLength={200}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="publish-ref">
            Your reference
          </label>
          <input
            id="publish-ref"
            className="input"
            value={externalRef}
            onChange={(event) => setExternalRef(event.target.value)}
            placeholder="mw11-arsenal"
            minLength={1}
            maxLength={200}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="publish-price">
            Price (USDC)
          </label>
          <input
            id="publish-price"
            className="input mono"
            type="number"
            step="0.01"
            min="0.01"
            max="100"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="publish-payload">
          Payload (JSON)
        </label>
        <textarea
          id="publish-payload"
          className="input mono h-40 py-3 text-[11px]"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          spellCheck={false}
          required
        />
      </div>

      <p className="text-muted text-xs leading-relaxed">
        Publishing costs a flat listing fee paid to Saksi. Buyers then pay your wallet directly at
        the price above. Saksi stores the payload as written and makes no claim about its accuracy.
      </p>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="card p-4">
          <p className="mono text-green text-[10px] tracking-[0.18em] uppercase">
            Listing fee settled
          </p>
          <p className="text-paper mt-2 text-sm">{result.signal.title}</p>
          <div className="border-line text-muted mt-3 space-y-1 border-t pt-3 text-[11px]">
            <p className="mono break-all">fee digest {result.listingFee.digest}</p>
            <p className="mono">
              {result.signal.payToAddress === null
                ? "paid to the platform address"
                : `paid to you at ${result.signal.payToAddress.slice(0, 10)}…`}
            </p>
            <a
              href={result.listingFee.explorerUrl}
              target="_blank"
              rel="noreferrer"
              className="link-underline text-amber inline-block"
            >
              Open the fee settlement on explorer →
            </a>
          </div>
        </div>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Signing, settling, verifying…" : "Pay listing fee & publish"}
      </button>
    </form>
  );
}
