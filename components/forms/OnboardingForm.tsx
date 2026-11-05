"use client";

import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { WalletMenu } from "@/components/WalletMenu";
import { requestJson } from "@/lib/client-api";
import { formatRecoveryCode } from "@/lib/recovery-format";

const challengeSchema = z
  .object({
    challenge: z
      .object({
        nonce: z.string(),
        address: z.string(),
        message: z.string(),
        expiresAt: z.string(),
      })
      .loose(),
  })
  .loose();

const claimSchema = z
  .object({
    user: z.object({ id: z.string(), handle: z.string() }).loose(),
    recoveryCode: z.string().min(1),
  })
  .loose();

/**
 * Claiming a handle requires a wallet signature over a message Saksi issued.
 *
 * The address becomes part of the journal's identity: it is where buyers pay, and it is
 * unique across all journals. Accepting it without proof would let anyone register a
 * wallet they do not control, so the form always issues a challenge first, asks the
 * wallet to sign the exact bytes the server will verify, and only then creates the row.
 */
export function OnboardingForm() {
  const router = useRouter();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();

  const [handle, setHandle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{
    readonly handle: string;
    readonly recoveryCode: string;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) {
      setError("Connect a Sui wallet first: your handle is bound to the address you prove.");
      return;
    }

    setPending(true);
    setError(null);
    try {
      const challenge = await requestJson({
        url: "/api/session",
        method: "PUT",
        body: { address: account.address, purpose: "claim", subject: handle.trim() },
        schema: challengeSchema,
      });

      // Sign exactly the message the server stored, never a locally rebuilt copy.
      const signed = await dAppKit.signPersonalMessage({
        message: new TextEncoder().encode(challenge.challenge.message),
        network: "mainnet",
      });

      const result = await requestJson({
        url: "/api/session",
        method: "POST",
        body: {
          handle: handle.trim(),
          address: challenge.challenge.address,
          nonce: challenge.challenge.nonce,
          signature: signed.signature,
        },
        schema: claimSchema,
      });

      setCreated({ handle: result.user.handle, recoveryCode: result.recoveryCode });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the journal.");
    } finally {
      setPending(false);
    }
  }

  // The session already exists at this point; the code below is the only copy that will
  // ever be shown, so the user must confirm they stored it before entering the journal.
  if (created !== null) {
    return (
      <div className="space-y-4">
        <div>
          <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
            Journal @{created.handle} created
          </p>
          <h3 className="display mt-2 text-2xl">Save your recovery code</h3>
          <p className="text-muted mt-2 text-xs leading-relaxed">
            Your wallet is now the way in. This code is the{" "}
            <strong className="text-paper">only</strong> fallback if that wallet is lost or
            replaced. It is shown once and cannot be recovered.
          </p>
        </div>

        <div className="border-amber/40 bg-amber/5 rounded-xl border p-4">
          <p className="mono text-paper text-center text-lg tracking-[0.18em] break-all">
            {formatRecoveryCode(created.recoveryCode)}
          </p>
        </div>

        <button
          type="button"
          className="btn btn-ghost w-full text-xs"
          onClick={() => {
            void navigator.clipboard.writeText(formatRecoveryCode(created.recoveryCode));
          }}
        >
          Copy code
        </button>

        <label className="text-muted flex items-start gap-2 text-xs leading-relaxed">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>I stored this code somewhere safe. I understand it cannot be shown again.</span>
        </label>

        <button
          type="button"
          className="btn btn-primary w-full"
          disabled={!acknowledged}
          onClick={() => {
            router.push("/picks");
            router.refresh();
          }}
        >
          Enter my journal
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <p className="label">Step 1 — Prove a Sui wallet</p>
        {account ? (
          <p className="border-green/30 bg-green/5 text-green mono mt-2 rounded-xl border px-3 py-2 text-[11px] break-all">
            {account.address}
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            <p className="text-muted text-xs leading-relaxed">
              Your address is where buyers pay you, so it must be proven by a signature. Saksi only
              asks you to sign a message; it authorises no payment and moves no funds.
            </p>
            <WalletMenu />
          </div>
        )}
      </div>

      <div>
        <label className="label" htmlFor="handle">
          Step 2 — Journal handle
        </label>
        <div className="flex items-center gap-2">
          <span className="mono text-muted text-sm">@</span>
          <input
            id="handle"
            name="handle"
            className="input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="saksi_reader"
            minLength={3}
            maxLength={24}
            pattern="[a-z0-9_]+"
            autoComplete="username"
            required
          />
        </div>
        <p className="text-muted mt-2 text-xs leading-relaxed">
          Lowercase letters, numbers and underscores. This is a display name, not a claim: your
          wallet is what identifies the journal, so the same handle can be used by another journal.
        </p>
      </div>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary w-full" disabled={pending || !account}>
        {pending ? "Waiting for your signature…" : "Sign & open my journal"}
      </button>

      <p className="text-muted border-line border-t pt-4 text-center text-xs">
        Already have a journal?{" "}
        <a href="/resume" className="text-amber hover:underline">
          Resume it with your recovery code
        </a>
      </p>
    </form>
  );
}
