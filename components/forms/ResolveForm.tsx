"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({
    pick: z.object({ status: z.string() }).loose(),
    outcome: z.object({ brier: z.number().nullable() }).loose(),
    memory: z.object({ outcomeBlobId: z.string() }).loose(),
  })
  .loose();

export function ResolveForm({ pickId }: { readonly pickId: string }) {
  const router = useRouter();
  const [result, setResult] = useState<"win" | "loss" | "void">("win");
  const [sourceUrl, setSourceUrl] = useState("");
  const [resolvedAt, setResolvedAt] = useState("");
  const [payoutUnits, setPayoutUnits] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const parsed = await requestJson({
        url: `/api/picks/${pickId}/resolve`,
        method: "POST",
        body: {
          result,
          sourceUrl: sourceUrl.trim(),
          ...(resolvedAt.length === 0 ? {} : { resolvedAt: new Date(resolvedAt).toISOString() }),
          ...(payoutUnits.length === 0 ? {} : { payoutUnits: Number(payoutUnits) }),
        },
        schema: responseSchema,
      });
      setNotice(
        `Resolved and written to Walrus Memory (blob ${parsed.memory.outcomeBlobId.slice(0, 12)}…).`,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Resolution failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-[0.7fr_1.3fr]">
        <div>
          <label className="label" htmlFor="resolve-result">
            Result
          </label>
          <select
            id="resolve-result"
            className="select"
            value={result}
            onChange={(event) => setResult(event.target.value as "win" | "loss" | "void")}
          >
            <option value="win">Win</option>
            <option value="loss">Loss</option>
            <option value="void">Void</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor="resolve-source">
            Real source URL
          </label>
          <input
            id="resolve-source"
            className="input"
            type="url"
            value={sourceUrl}
            onChange={(event) => setSourceUrl(event.target.value)}
            placeholder="https://…"
            required
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="resolve-at">
            Resolved at <span className="normal-case">(optional)</span>
          </label>
          <input
            id="resolve-at"
            className="input"
            type="datetime-local"
            value={resolvedAt}
            onChange={(event) => setResolvedAt(event.target.value)}
          />
        </div>
        <div>
          <label className="label" htmlFor="resolve-payout">
            Payout units <span className="normal-case">(optional)</span>
          </label>
          <input
            id="resolve-payout"
            className="input mono"
            type="number"
            min="0"
            max="1000000"
            value={payoutUnits}
            onChange={(event) => setPayoutUnits(event.target.value)}
          />
        </div>
      </div>

      <p className="text-muted text-xs leading-relaxed">
        Resolution is not automated. You must supply the source that proves the outcome; the URL and
        timestamp become part of the permanent memory.
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

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Writing outcome…" : "Resolve and score"}
      </button>
    </form>
  );
}
