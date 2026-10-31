import Link from "next/link";

import { PickCard } from "@/components/PickCard";
import { EmptyState, Hash, StatCard } from "@/components/ui";
import { APP_NAME, explorerTxUrl } from "@/lib/config";
import { getEnv } from "@/lib/env";
import { formatPercent, formatDateTime, shortHash } from "@/lib/format";
import { errorForLog, getLogger } from "@/lib/logger";
import { formatUsd } from "@/lib/price";
import { getSessionUser } from "@/lib/session";
import { eventsForDigests, type OnChainEvent } from "@/server/data/chain";
import { listRecentPayments, listRecentRecommendations } from "@/server/data/lifecycle";
import { leaderboard, pickStats, recentPicks } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const [user, stats, board, feed, recommendations, payments] = await Promise.all([
    getSessionUser(),
    pickStats(),
    leaderboard(),
    recentPicks(4),
    listRecentRecommendations(1),
    listRecentPayments(5),
  ]);

  let settlementEvents: OnChainEvent[] = [];
  let settlementQueryFailed = false;

  if (payments.length > 0) {
    try {
      settlementEvents = await eventsForDigests(payments.map((payment) => payment.digest));
    } catch (error) {
      settlementQueryFailed = true;
      getLogger().warn({ error: errorForLog(error) }, "dashboard settlement events unavailable");
    }
  }

  const paymentsByDigest = new Map(payments.map((payment) => [payment.digest, payment]));
  const network = getEnv().SUI_NETWORK;

  const top = board[0];
  const latestDecision = recommendations[0];
  const picks = feed.map((item) =>
    presentPick({
      pick: item.pick,
      viewerId: user?.id,
      ownerHandle: item.userHandle,
      analystName: item.analystName,
      analystKind: item.analystKind,
      outcome:
        item.outcome === null
          ? null
          : {
              result: item.outcome.result,
              resolvedAt: item.outcome.resolvedAt,
              sourceUrl: item.outcome.sourceUrl,
              resolvedBy: item.outcome.resolvedBy,
              brier: item.outcome.brier,
              payoutUnits: null,
            },
    }),
  );

  return (
    <div>
      <section className="border-line relative overflow-hidden border-b">
        <div className="grid-bg pointer-events-none absolute inset-0 opacity-70" />
        <div className="container-page relative grid items-end gap-12 pt-20 pb-16 lg:grid-cols-[1.25fr_0.75fr]">
          <div>
            <p className="mono text-amber text-[10px] tracking-[0.26em] uppercase">
              Total Recall · Tatum × Walrus Memory
            </p>
            <h1 className="display mt-6 max-w-3xl text-5xl leading-[0.95] sm:text-7xl">
              The prediction journal that cannot lie.
            </h1>
            <p className="text-muted mt-6 max-w-2xl text-[15px] leading-relaxed">
              Anyone can claim they called it. {APP_NAME} makes the claim checkable: seal the pick
              before the event, write the commitment to Walrus Memory, resolve it against a real
              source, and let your own history change the next decision.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href={user ? "/picks/new" : "/onboarding"} className="btn btn-primary">
                {user ? "Seal a pick" : "Start your journal"}
              </Link>
              <Link href="/picks" className="btn btn-ghost">
                Read the ledger
              </Link>
              <Link href="/signals" className="btn btn-ghost">
                Premium signals
              </Link>
            </div>
            <div className="mt-8 flex flex-wrap gap-2">
              <span className="badge badge-neutral">sha256 commitments</span>
              <span className="badge badge-neutral">Walrus Memory recall</span>
              <span className="badge badge-neutral">Tatum Sui GraphQL</span>
              <span className="badge badge-neutral">x402 on Sui</span>
            </div>
          </div>

          <div className="card p-5">
            <div className="flex items-center justify-between">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Live journal
              </p>
              <span className="relative flex size-2">
                <span className="bg-green absolute inline-flex size-full animate-ping rounded-full opacity-60" />
                <span className="bg-green relative inline-flex size-2 rounded-full" />
              </span>
            </div>
            <dl className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <dt className="text-muted text-[11px]">Sealed picks</dt>
                <dd className="stat-value text-amber mt-1">{stats.sealed}</dd>
              </div>
              <div>
                <dt className="text-muted text-[11px]">Resolved</dt>
                <dd className="stat-value mt-1">{stats.resolved}</dd>
              </div>
              <div>
                <dt className="text-muted text-[11px]">Analysts tracked</dt>
                <dd className="stat-value mt-1">{board.length}</dd>
              </div>
              <div>
                <dt className="text-muted text-[11px]">Top credibility</dt>
                <dd className="stat-value text-green mt-1">{top ? top.credibility.score : 0}</dd>
              </div>
            </dl>
            <div className="border-line text-muted mt-5 border-t pt-4 text-[11px] leading-relaxed">
              {top ? (
                <p>
                  Leading analyst{" "}
                  <Link href={`/analysts/${top.analyst.id}`} className="link-underline text-paper">
                    {top.analyst.name}
                  </Link>{" "}
                  · {top.credibility.resolved} resolved · Brier{" "}
                  {top.credibility.meanBrier === null
                    ? "n/a"
                    : top.credibility.meanBrier.toFixed(3)}
                </p>
              ) : (
                <p>No analyst has resolved evidence yet. The leaderboard starts empty.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className="container-page grid gap-3 py-8 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Commitments"
          value={stats.total}
          detail={`${stats.sealed} sealed · ${stats.revealed} revealed`}
        />
        <StatCard
          label="Resolved outcomes"
          value={stats.resolved}
          detail={`${stats.voided} voided`}
          tone="green"
        />
        <StatCard
          label="Memory decision"
          value={latestDecision ? latestDecision.response.verdict : "—"}
          detail={
            latestDecision
              ? `${latestDecision.citedMemoryIds.length} memories cited`
              : "Ask memory before your first pick"
          }
          tone="amber"
        />
        <StatCard label="Proof layer" value="3" detail="Walrus Memory · Tatum · x402 settlement" />
      </section>

      {latestDecision ? (
        <section className="container-page pb-6">
          <div className="card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
                Memory changed a decision
              </p>
              <span className="mono text-muted text-[10px]">
                {latestDecision.citedMemoryIds.length} cited memories
              </span>
            </div>
            <p className="display mt-3 text-2xl">{latestDecision.response.summary}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {latestDecision.citedMemoryIds.slice(0, 4).map((blobId) => (
                <span key={blobId} className="badge badge-neutral">
                  {shortHash(blobId, 10, 8)}
                </span>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      <section className="container-page pb-6">
        <div className="card p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
                Tatum GraphQL · transaction events
              </p>
              <h2 className="display mt-2 text-2xl">Live settlement feed</h2>
            </div>
            <span className="mono text-muted text-[10px]">
              {payments.length === 0
                ? "no settlements recorded"
                : settlementQueryFailed
                  ? "query failed"
                  : `${settlementEvents.length} events across ${payments.length} digests`}
            </span>
          </div>

          {payments.length === 0 ? (
            <p className="text-muted mt-4 text-xs leading-relaxed">
              No premium settlement has been recorded yet. The feed starts with the first
              Tatum-verified payment.
            </p>
          ) : settlementQueryFailed ? (
            <p className="text-red mt-4 text-xs leading-relaxed">
              Tatum did not return events for the latest settlements. No substitute feed is shown.
            </p>
          ) : settlementEvents.length === 0 ? (
            <p className="text-muted mt-4 text-xs leading-relaxed">
              The latest settlements emitted no event records. The empty result comes from Tatum,
              not a fallback.
            </p>
          ) : (
            <div className="divide-line mt-4 divide-y">
              {settlementEvents.slice(0, 6).map((event, index) => {
                const payment = paymentsByDigest.get(event.digest);
                return (
                  <div
                    key={`${event.digest}-${event.type}-${index}`}
                    className="flex flex-wrap items-center justify-between gap-3 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-paper truncate text-sm">{event.type}</p>
                      <p className="mono text-muted mt-1 text-[10px]">
                        {payment
                          ? `${payment.provider} · ${formatUsd(payment.amountAtomic)} · ${formatDateTime(payment.verifiedAt)}`
                          : "unmatched settlement digest"}
                      </p>
                    </div>
                    <a
                      href={explorerTxUrl(network, event.digest)}
                      target="_blank"
                      rel="noreferrer"
                      className="link-underline shrink-0"
                    >
                      <Hash value={event.digest} head={10} tail={8} />
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="container-page grid gap-8 py-10 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="display text-3xl">Latest commitments</h2>
            <Link href="/picks" className="link-underline text-amber text-xs">
              All picks →
            </Link>
          </div>
          {picks.length === 0 ? (
            <EmptyState
              title="No picks yet"
              description="A sealed pick is the first honest thing in the journal. Start one before the next event."
              action={
                <Link href="/picks/new" className="btn btn-primary">
                  Seal the first pick
                </Link>
              }
            />
          ) : (
            <div className="space-y-3">
              {picks.map((pick) => (
                <PickCard key={pick.id} pick={pick} />
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-4 flex items-end justify-between">
            <h2 className="display text-3xl">Credibility</h2>
            <Link href="/analysts" className="link-underline text-amber text-xs">
              Leaderboard →
            </Link>
          </div>
          <div className="card divide-line divide-y">
            {board.length === 0 ? (
              <p className="text-muted p-5 text-sm">No analysts tracked yet.</p>
            ) : (
              board.slice(0, 6).map((entry, index) => (
                <Link
                  key={entry.analyst.id}
                  href={`/analysts/${entry.analyst.id}`}
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-white/5"
                >
                  <div className="flex items-center gap-3">
                    <span className="mono text-muted w-5 text-[10px]">{index + 1}</span>
                    <div>
                      <p className="text-paper text-sm">{entry.analyst.name}</p>
                      <p className="mono text-muted text-[10px] uppercase">{entry.analyst.kind}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="mono text-green text-sm">{entry.credibility.score}</p>
                    <p className="mono text-muted text-[10px]">
                      {formatPercent(entry.credibility.winRate, 0)} win
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>

          <div className="card mt-4 p-5">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Proof loop</p>
            <ol className="text-muted mt-3 space-y-3 text-xs leading-relaxed">
              <li>
                <span className="text-amber">01</span> Canonical hash sealed in Postgres and Walrus
                Memory.
              </li>
              <li>
                <span className="text-amber">02</span> Reveal recomputes the hash; a mismatch is
                refused.
              </li>
              <li>
                <span className="text-amber">03</span> Resolve with source URL + timestamp, then
                score Brier, credibility and bias.
              </li>
              <li>
                <span className="text-amber">04</span> Recall those memories before the next pick,
                with citations and distances.
              </li>
            </ol>
          </div>
        </div>
      </section>
    </div>
  );
}
