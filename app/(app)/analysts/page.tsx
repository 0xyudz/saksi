import Link from "next/link";

import { NewAnalystForm } from "@/components/forms/NewAnalystForm";
import { EmptyState, PageHeader } from "@/components/ui";
import { formatPercent } from "@/lib/format";
import { leaderboard } from "@/server/data/picks";

export const dynamic = "force-dynamic";
export const metadata = { title: "Analysts" };

export default async function AnalystsPage() {
  const board = await leaderboard();

  return (
    <div>
      <PageHeader
        eyebrow="Credibility, not guesses"
        title="Who has earned trust?"
        description="Scores come only from revealed picks with resolved outcomes. Accuracy is shrunk toward zero for small samples and decayed with a 90-day half-life; calibration keeps lucky longshots from topping the board. The verified score counts only outcomes an independent results provider confirmed."
        actions={
          <Link href="/picks/new" className="btn btn-primary">
            Test an analyst
          </Link>
        }
      />

      <div className="container-page grid gap-8 pb-20 lg:grid-cols-[1.4fr_0.6fr]">
        <section>
          {board.length === 0 ? (
            <EmptyState
              title="No resolved evidence yet"
              description="Add the analyst or source you plan to follow, seal a pick, and resolve it against a real outcome source. Credibility starts with evidence."
            />
          ) : (
            <div className="space-y-3">
              {board.map((entry, index) => (
                <Link
                  key={entry.analyst.id}
                  href={`/analysts/${entry.analyst.id}`}
                  className="card flex flex-col gap-4 p-5 transition-colors hover:border-white/20 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-4">
                    <span className="mono text-muted w-6 text-xs">{index + 1}</span>
                    <div>
                      <p className="display text-2xl">{entry.analyst.name}</p>
                      <p className="mono text-muted mt-1 text-[10px] tracking-[0.14em] uppercase">
                        {entry.analyst.kind}
                        {entry.analyst.externalRef ? ` · ${entry.analyst.externalRef}` : ""}
                      </p>
                      {entry.communityAttestedSamples > 0 ? (
                        <p className="mono text-muted mt-1 text-[10px] tracking-[0.14em] uppercase">
                          Community-attested
                        </p>
                      ) : null}
                      {entry.oracleVerifiedSamples > 0 ? (
                        <p className="mono text-green mt-1 text-[10px] tracking-[0.14em] uppercase">
                          {entry.oracleVerifiedSamples} oracle verified
                        </p>
                      ) : (
                        <p className="mono text-muted mt-1 text-[10px] tracking-[0.14em] uppercase">
                          no verified outcomes
                        </p>
                      )}
                      {entry.contradictedSamples > 0 ? (
                        <p className="mono text-red mt-1 text-[10px] tracking-[0.14em] uppercase">
                          {entry.contradictedSamples} contradicted
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="grid grid-cols-4 gap-4 text-right sm:w-[380px]">
                    <div>
                      <p className="mono text-green text-lg">{entry.credibility.score}</p>
                      <p className="text-muted text-[10px]">score</p>
                    </div>
                    <div>
                      <p
                        className={`mono text-lg ${
                          entry.credibility.hasVerifiedEvidence ? "text-amber" : "text-muted"
                        }`}
                      >
                        {entry.credibility.verifiedScore}
                      </p>
                      <p className="text-muted text-[10px]">verified</p>
                    </div>
                    <div>
                      <p className="mono text-lg">{entry.credibility.resolved}</p>
                      <p className="text-muted text-[10px]">resolved</p>
                    </div>
                    <div>
                      <p className="mono text-lg">{formatPercent(entry.credibility.winRate, 0)}</p>
                      <p className="text-muted text-[10px]">win rate</p>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section className="card p-6">
            <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">Add a subject</p>
            <h2 className="display mt-2 text-2xl">Track an analyst or source</h2>
            <p className="text-muted mt-2 mb-5 text-xs leading-relaxed">
              A paid data provider can be an analyst of kind{" "}
              <span className="text-paper">source</span>. Its signal purchases become part of the
              ROI memory the recommender cites.
            </p>
            <NewAnalystForm />
          </section>

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
              How the score works
            </p>
            <div className="text-muted mt-3 space-y-3 text-xs leading-relaxed">
              <p>
                <span className="text-paper">65% Wilson accuracy</span> — small samples cannot
                produce a high score.
              </p>
              <p>
                <span className="text-paper">35% calibration</span> — mean Brier score punishes
                overconfidence.
              </p>
              <p>
                <span className="text-paper">90-day half-life</span> — old streaks decay instead of
                carrying a career.
              </p>
              <p className="border-line border-t pt-3">
                <span className="text-paper">Verified score</span> — recomputed using only outcomes
                an independent results provider confirmed. A journal can have a high score and a
                verified score of zero; that gap is the whole point.
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
