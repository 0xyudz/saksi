"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";
import { shortHash } from "@/lib/format";

const responseSchema = z
  .object({
    signal: z
      .object({
        id: z.string(),
        provider: z.string(),
        title: z.string(),
        payload: z.unknown(),
      })
      .loose(),
    payment: z
      .object({
        digest: z.string(),
        payer: z.string().nullable(),
        explorerUrl: z.string().url(),
        amountAtomic: z.string(),
      })
      .loose(),
    memory: z.object({ blobIds: z.array(z.string()) }).loose(),
  })
  .loose();

type PurchaseResult = z.infer<typeof responseSchema>;

export interface PurchasePickOption {
  readonly id: string;
  readonly label: string;
}

export function PurchaseSignalPanel({
  signalId,
  pickOptions,
}: {
  readonly signalId: string;
  readonly pickOptions: readonly PurchasePickOption[];
}) {
  const router = useRouter();
  const [pickId, setPickId] = useState("");
  const [result, setResult] = useState<PurchaseResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function purchase() {
    setPending(true);
    setError(null);
    try {
      const parsed = await requestJson({
        url: "/api/payments/purchase",
        method: "POST",
        body: {
          signalId,
          ...(pickId.length === 0 ? {} : { pickId }),
        },
        schema: responseSchema,
      });
      setResult(parsed);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Purchase failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-4">
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
        {pending ? "Paying & verifying on Sui…" : "Buy with x402 on Sui"}
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
            <p className="mono break-all">digest {result.payment.digest}</p>
            <p className="mono">payer {result.payment.payer ?? "unknown"}</p>
            <p className="mono">amount {result.payment.amountAtomic} atomic</p>
            {result.memory.blobIds.length > 0 ? (
              <p className="mono">memory {shortHash(result.memory.blobIds[0] ?? "", 12, 10)}</p>
            ) : null}
            <a
              href={result.payment.explorerUrl}
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
