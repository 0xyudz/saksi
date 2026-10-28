"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({
    verified: z.literal(true),
    digest: z.string(),
    payer: z.string(),
    amountAtomic: z.string(),
    explorerUrl: z.string().url(),
    recorded: z.boolean(),
    signalId: z.string().uuid().nullable(),
  })
  .loose();

export function VerifyPaymentForm() {
  const router = useRouter();
  const [signalId, setSignalId] = useState("");
  const [digest, setDigest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const result = await requestJson({
        url: "/api/payments/verify",
        method: "POST",
        body: { signalId: signalId.trim(), digest: digest.trim() },
        schema: responseSchema,
      });
      setNotice(
        `Tatum verified ${result.amountAtomic} atomic paid by ${result.payer}. ` +
          (result.recorded
            ? `Already recorded for signal ${result.signalId}.`
            : "Not recorded by Saksi; this check is read-only."),
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Verification failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="verify-signal">
          Signal id
        </label>
        <input
          id="verify-signal"
          className="input mono"
          value={signalId}
          onChange={(event) => setSignalId(event.target.value)}
          placeholder="00000000-0000-0000-0000-000000000000"
          required
        />
      </div>
      <div>
        <label className="label" htmlFor="verify-digest">
          Sui transaction digest
        </label>
        <input
          id="verify-digest"
          className="input mono"
          value={digest}
          onChange={(event) => setDigest(event.target.value)}
          placeholder="base58 digest"
          required
        />
      </div>
      <p className="text-muted text-xs leading-relaxed">
        The digest is checked against Tatum&apos;s Sui RPC: successful status, configured recipient,
        configured coin, and at least the signal price. This is read-only: no payment or memory row
        is created here.
      </p>
      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="border-green/30 bg-green/10 text-green rounded-xl border px-3 py-2 text-xs">
          {notice}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending}>
        {pending ? "Asking Tatum…" : "Verify digest"}
      </button>
    </form>
  );
}
