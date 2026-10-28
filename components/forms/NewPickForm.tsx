"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";

const responseSchema = z
  .object({
    pick: z.object({ id: z.string().uuid(), commitmentHash: z.string() }).loose(),
    memory: z.object({ blobId: z.string() }).loose(),
  })
  .loose();

export interface AnalystOption {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
}

export function NewPickForm({ analysts }: { readonly analysts: readonly AnalystOption[] }) {
  const router = useRouter();
  const [analystId, setAnalystId] = useState(analysts[0]?.id ?? "");
  const [eventRef, setEventRef] = useState("");
  const [market, setMarket] = useState("");
  const [selection, setSelection] = useState("");
  const [odds, setOdds] = useState("2.10");
  const [stakeUnits, setStakeUnits] = useState("10");
  const [revealAt, setRevealAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const result = await requestJson({
        url: "/api/picks",
        method: "POST",
        body: {
          analystId,
          eventRef: eventRef.trim(),
          market: market.trim(),
          selection: selection.trim(),
          odds: Number(odds),
          stakeUnits: Number(stakeUnits),
          ...(revealAt.length === 0 ? {} : { revealAt: new Date(revealAt).toISOString() }),
        },
        schema: responseSchema,
      });
      router.push(`/picks/${result.pick.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not seal the pick.");
    } finally {
      setPending(false);
    }
  }

  if (analysts.length === 0) {
    return (
      <p className="border-amber/30 bg-amber/5 text-amber rounded-xl border px-4 py-3 text-sm">
        Add an analyst first — a pick needs a subject whose credibility can be scored.
      </p>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label className="label" htmlFor="pick-analyst">
          Analyst
        </label>
        <select
          id="pick-analyst"
          className="select"
          value={analystId}
          onChange={(event) => setAnalystId(event.target.value)}
          required
        >
          {analysts.map((analyst) => (
            <option key={analyst.id} value={analyst.id}>
              {analyst.name} · {analyst.kind}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="pick-event">
            Event reference
          </label>
          <input
            id="pick-event"
            className="input"
            value={eventRef}
            onChange={(event) => setEventRef(event.target.value)}
            placeholder="fixture id, market slug, URL"
            minLength={2}
            maxLength={200}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pick-market">
            Market
          </label>
          <input
            id="pick-market"
            className="input"
            value={market}
            onChange={(event) => setMarket(event.target.value)}
            placeholder="Premier League · Match winner"
            minLength={2}
            maxLength={200}
            required
          />
        </div>
      </div>

      <div>
        <label className="label" htmlFor="pick-selection">
          Selection
        </label>
        <input
          id="pick-selection"
          className="input"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
          placeholder="Arsenal to win"
          minLength={1}
          maxLength={200}
          required
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <label className="label" htmlFor="pick-odds">
            Decimal odds
          </label>
          <input
            id="pick-odds"
            className="input mono"
            type="number"
            step="0.01"
            min="1.01"
            max="1000"
            value={odds}
            onChange={(event) => setOdds(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pick-stake">
            Stake units
          </label>
          <input
            id="pick-stake"
            className="input mono"
            type="number"
            step="1"
            min="1"
            max="1000000"
            value={stakeUnits}
            onChange={(event) => setStakeUnits(event.target.value)}
            required
          />
        </div>
        <div>
          <label className="label" htmlFor="pick-reveal">
            Time lock <span className="normal-case">(optional)</span>
          </label>
          <input
            id="pick-reveal"
            className="input"
            type="datetime-local"
            value={revealAt}
            onChange={(event) => setRevealAt(event.target.value)}
          />
        </div>
      </div>

      <p className="text-muted text-xs leading-relaxed">
        Sealing writes the canonical payload hash and the full pick to Walrus Memory. The hash is
        what later verification checks; changing any field breaks the reveal.
      </p>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "Sealing to Walrus…" : "Seal this pick"}
      </button>
    </form>
  );
}
