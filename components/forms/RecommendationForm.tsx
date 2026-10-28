"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";

import { requestJson } from "@/lib/client-api";
import { formatPercent, shortHash } from "@/lib/format";

const citationSchema = z
  .object({
    blobId: z.string(),
    text: z.string(),
    distance: z.number(),
    createdAt: z.string().optional(),
  })
  .loose();

const recommendationSchema = z
  .object({
    recommendation: z
      .object({
        verdict: z.enum(["proceed", "reduce", "avoid"]),
        confidence: z.number(),
        summary: z.string(),
        reasons: z.array(z.string()),
        warnings: z.array(
          z
            .object({
              kind: z.enum(["bias", "source_roi", "credibility", "calibration"]),
              message: z.string(),
              evidence: z.number(),
              memory: citationSchema.nullable(),
            })
            .loose(),
        ),
        sources: z.array(
          z
            .object({
              provider: z.string(),
              spendAtomic: z.string(),
              correct: z.number(),
              wrong: z.number(),
              roi: z.number(),
              memory: citationSchema.nullable(),
            })
            .loose(),
        ),
        citations: z.array(citationSchema),
        recallCount: z.number(),
      })
      .loose(),
  })
  .loose();

export interface RecommendationAnalystOption {
  readonly id: string;
  readonly name: string;
}

const VERDICT_CLASS = {
  proceed: "badge-success",
  reduce: "badge-sealed",
  avoid: "badge-danger",
} as const;

export function RecommendationForm({
  analysts,
}: {
  readonly analysts: readonly RecommendationAnalystOption[];
}) {
  const [analystId, setAnalystId] = useState(analysts[0]?.id ?? "");
  const [market, setMarket] = useState("");
  const [selection, setSelection] = useState("");
  const [odds, setOdds] = useState("2.10");
  const [result, setResult] = useState<
    z.infer<typeof recommendationSchema>["recommendation"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const parsed = await requestJson({
        url: "/api/recommendations",
        method: "POST",
        body: {
          analystId,
          market: market.trim(),
          selection: selection.trim(),
          odds: Number(odds),
        },
        schema: recommendationSchema,
      });
      setResult(parsed.recommendation);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recall failed.");
    } finally {
      setPending(false);
    }
  }

  if (analysts.length === 0) return null;

  return (
    <div className="space-y-5">
      <form onSubmit={onSubmit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr]">
          <div>
            <label className="label" htmlFor="rec-analyst">
              Analyst to check
            </label>
            <select
              id="rec-analyst"
              className="select"
              value={analystId}
              onChange={(event) => setAnalystId(event.target.value)}
              required
            >
              {analysts.map((analyst) => (
                <option key={analyst.id} value={analyst.id}>
                  {analyst.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="rec-odds">
              Decimal odds
            </label>
            <input
              id="rec-odds"
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
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="rec-market">
              Market
            </label>
            <input
              id="rec-market"
              className="input"
              value={market}
              onChange={(event) => setMarket(event.target.value)}
              placeholder="Premier League · Match winner"
              required
            />
          </div>
          <div>
            <label className="label" htmlFor="rec-selection">
              Selection
            </label>
            <input
              id="rec-selection"
              className="input"
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
              placeholder="Arsenal to win"
              required
            />
          </div>
        </div>
        <button type="submit" className="btn" disabled={pending}>
          {pending ? "Recalling memory…" : "Ask memory before sealing"}
        </button>
      </form>

      {error ? (
        <p className="border-red/30 bg-red/10 text-red rounded-xl border px-3 py-2 text-xs">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className={`badge ${VERDICT_CLASS[result.verdict]}`}>{result.verdict}</span>
            <span className="mono text-muted text-xs">
              confidence {formatPercent(result.confidence, 0)} · recalled {result.recallCount}
            </span>
          </div>
          <p className="text-paper mt-4 text-sm leading-relaxed">{result.summary}</p>

          {result.reasons.length > 0 ? (
            <ul className="mt-4 space-y-2">
              {result.reasons.map((reason) => (
                <li key={reason} className="text-muted flex gap-2 text-xs leading-relaxed">
                  <span className="text-amber">·</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          ) : null}

          {result.warnings.length > 0 ? (
            <div className="mt-5 space-y-2">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Memory warnings
              </p>
              {result.warnings.map((warning, index) => (
                <div
                  key={`${warning.kind}-${index}`}
                  className="border-amber/25 bg-amber/5 rounded-xl border p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="mono text-amber text-[10px] tracking-[0.14em] uppercase">
                      {warning.kind}
                    </span>
                    {warning.memory ? (
                      <span className="mono text-muted text-[10px]">
                        distance {warning.memory.distance.toFixed(3)}
                      </span>
                    ) : null}
                  </div>
                  <p className="text-paper/90 mt-2 text-xs leading-relaxed">{warning.message}</p>
                  {warning.memory ? (
                    <p className="text-muted mt-2 rounded-lg bg-black/30 p-2 font-mono text-[10px] leading-relaxed break-all">
                      {warning.memory.text}
                      <span className="text-muted/60 mt-1 block">
                        blob {shortHash(warning.memory.blobId, 12, 10)}
                      </span>
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {result.sources.length > 0 ? (
            <div className="mt-5">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Paid source ROI in memory
              </p>
              <div className="mt-2 space-y-2">
                {result.sources.map((source) => (
                  <div
                    key={source.provider}
                    className="border-line flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-xs"
                  >
                    <span className="text-paper">{source.provider}</span>
                    <span className="mono text-muted">
                      {source.correct}-{source.wrong} · ROI {formatPercent(source.roi)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {result.citations.length > 0 ? (
            <div className="mt-5">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Cited memories
              </p>
              <div className="mt-2 space-y-2">
                {result.citations.map((citation) => (
                  <div key={citation.blobId} className="border-line rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-muted text-[10px]">
                        {shortHash(citation.blobId, 12, 10)}
                      </span>
                      <span className="mono text-amber text-[10px]">
                        distance {citation.distance.toFixed(3)}
                      </span>
                    </div>
                    <p className="text-paper/80 mt-2 font-mono text-[10px] leading-relaxed break-all">
                      {citation.text}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
