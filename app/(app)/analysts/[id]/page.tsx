import Link from "next/link";
import { notFound } from "next/navigation";

import {
  EmptyState,
  OutcomeBadge,
  PageHeader,
  StatCard,
  StatusBadge,
  VerificationBadge,
} from "@/components/ui";
import { formatDateTime, formatOdds, formatPercent } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getSessionUser } from "@/lib/session";
import {
  analystCredibility,
  getAnalyst,
  listPicksForAnalyst,
  loadAnalystSamples,
} from "@/server/data/picks";
import { calibrationBins } from "@/server/scoring/brier";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Analyst" };
  const analyst = await getAnalyst(id);
  return { title: analyst ? analyst.name : "Analyst" };
}

export default async function AnalystDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [analyst, user, credibility, samples, picks] = await Promise.all([
    getAnalyst(id),
    getSessionUser(),
    analystCredibility(id),
    loadAnalystSamples(id),
    listPicksForAnalyst(id, 20),
  ]);

  if (!analyst) notFound();

  const communityAttested = samples.filter((sample) =>
    sample.outcome.resolvedBy.startsWith("user:"),
  ).length;
  const oracleVerified = samples.filter((sample) => sample.outcome.verified).length;
  const contradicted = samples.filter(
    (sample) => sample.outcome.verification === "oracle_contradicted",
  ).length;

  const calibration = calibrationBins(
    samples.flatMap((sample) =>
      sample.outcome.result === "void"
        ? []
        : [
            {
              probability: 1 / sample.pick.odds,
              outcome: sample.outcome.result,
            },
          ],
    ),
  );

  return (
    <div>
      <PageHeader
        eyebrow={`${analyst.kind}${analyst.externalRef ? ` · ${analyst.externalRef}` : ""}`}
        title={analyst.name}
        description={
          credibility.resolved === 0
            ? "No resolved evidence yet. A credibility score of zero is the honest starting point, not a penalty."
            : `${credibility.resolved} resolved picks, ${credibility.wins} wins and ${credibility.losses} losses. Score blends recency-weighted accuracy with calibration.`
        }
        actions={
          <Link href="/analysts" className="btn btn-ghost">
            All analysts
          </Link>
        }
      />

      <div className="container-page pb-20">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Credibility" value={credibility.score} detail="0–100" tone="green" />
          <StatCard
            label="Verified score"
            value={credibility.verifiedScore}
            detail={
              credibility.hasVerifiedEvidence
                ? `${credibility.verifiedResolved} oracle-confirmed`
                : "no oracle-confirmed outcome"
            }
            tone={credibility.hasVerifiedEvidence ? "amber" : "paper"}
          />
          <StatCard
            label="Win rate"
            value={formatPercent(credibility.winRate, 1)}
            detail={`${credibility.wins}W · ${credibility.losses}L · ${credibility.voids}V`}
          />
          <StatCard
            label="Mean Brier"
            value={credibility.meanBrier === null ? "—" : credibility.meanBrier.toFixed(3)}
            detail="lower is better"
            tone={credibility.meanBrier !== null && credibility.meanBrier > 0.25 ? "red" : "paper"}
          />
        </div>

        <div className="mt-3 space-y-2">
          {oracleVerified > 0 ? (
            <p className="text-muted text-xs leading-relaxed">
              <span className="badge badge-success mr-2">Oracle verified</span>
              {oracleVerified} of {samples.length} resolved samples were confirmed by an independent
              results provider. Only these count toward the verified score.
            </p>
          ) : (
            <p className="text-muted text-xs leading-relaxed">
              <span className="badge badge-neutral mr-2">No verified evidence</span>
              No resolved pick has been confirmed by an independent provider yet, so the verified
              score is zero regardless of the headline score.
            </p>
          )}
          {contradicted > 0 ? (
            <p className="text-muted text-xs leading-relaxed">
              <span className="badge badge-loss mr-2">Contradicted</span>
              {contradicted} claim{contradicted === 1 ? " was" : "s were"} contradicted by the
              provider. The owner&apos;s claim is preserved, but it earns no verified credit.
            </p>
          ) : null}
          {communityAttested > 0 ? (
            <p className="text-muted text-xs leading-relaxed">
              <span className="badge badge-neutral mr-2">Self-attested</span>
              {communityAttested} of {samples.length} resolved samples were supplied by the pick
              owner, with a source URL rather than an independent oracle.
            </p>
          ) : null}
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="card p-6">
            <div className="flex items-end justify-between gap-4">
              <div>
                <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                  Calibration
                </p>
                <h2 className="display mt-2 text-2xl">Predicted vs observed</h2>
              </div>
              <span className="mono text-muted text-[10px]">{samples.length} resolved samples</span>
            </div>

            <div className="mt-6 space-y-2">
              {calibration.map((bin) => (
                <div key={bin.label} className="grid grid-cols-[52px_1fr_52px] items-center gap-3">
                  <span className="mono text-muted text-[10px]">{bin.label}</span>
                  <div className="relative h-5 rounded bg-white/5">
                    <div
                      className="bg-amber/25 absolute inset-y-0 left-0 rounded"
                      style={{ width: `${Math.min(100, bin.predicted * 100)}%` }}
                    />
                    <div
                      className="border-green bg-green/20 absolute inset-y-0 left-0 rounded border-r"
                      style={{ width: `${Math.min(100, bin.observed * 100)}%` }}
                    />
                  </div>
                  <span className="mono text-muted text-right text-[10px]">{bin.count}</span>
                </div>
              ))}
            </div>
            <p className="text-muted mt-4 text-xs leading-relaxed">
              The amber bar is the average implied probability in the bin; the green edge is the
              observed win rate. A green edge left of amber means overconfidence.
            </p>
          </section>

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Recent picks</p>
            {picks.length === 0 ? (
              <p className="text-muted mt-4 text-sm">No picks reference this analyst yet.</p>
            ) : (
              <div className="mt-4 space-y-3">
                {picks.slice(0, 8).map((pick) => {
                  const sealed = pick.status === "sealed" && pick.journalRef !== user?.id;
                  return (
                    <Link
                      key={pick.id}
                      href={`/picks/${pick.id}`}
                      className="border-line block rounded-xl border p-3 transition-colors hover:border-white/20"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <StatusBadge status={pick.status} />
                        <span className="mono text-muted text-[10px]">
                          {formatDateTime(pick.committedAt)}
                        </span>
                      </div>
                      <p className={`mt-2 text-sm ${sealed ? "text-muted" : "text-paper"}`}>
                        {sealed ? "Sealed prediction" : pick.selection}
                      </p>
                      {!sealed ? (
                        <p className="mono text-muted mt-1 text-[10px]">
                          {pick.market} · odds {formatOdds(pick.odds)} · {pick.stakeUnits}u
                        </p>
                      ) : null}
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <section className="mt-8">
          <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Evidence trail</p>
          {samples.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="No outcome evidence"
                description="Resolve a pick for this analyst to begin the record. Every resolved sample must include a source URL and timestamp."
              />
            </div>
          ) : (
            <div className="card divide-line mt-3 divide-y">
              {samples.map((sample) => (
                <div
                  key={sample.pick.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <OutcomeBadge result={sample.outcome.result} />
                    <VerificationBadge verification={sample.outcome.verification} />
                    <div>
                      <p className="text-sm">{sample.pick.selection}</p>
                      <p className="mono text-muted text-[10px]">
                        odds {formatOdds(sample.pick.odds)} ·{" "}
                        {formatDateTime(sample.outcome.resolvedAt)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="mono text-muted text-[10px]">
                      Brier{" "}
                      {sample.outcome.brier === null ? "void" : sample.outcome.brier.toFixed(3)}
                    </span>
                    <a
                      href={sample.outcome.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="link-underline text-amber text-xs"
                    >
                      Source ↗
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
