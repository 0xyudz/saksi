import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, Hash, PageHeader, StatCard } from "@/components/ui";
import { listMemories, recallNamespace } from "@/integrations/walrus-memory/client";
import { JOURNAL_MEMORY_KINDS, parseMemory } from "@/integrations/walrus-memory/schema";
import { formatDateTime } from "@/lib/format";
import { getEnv } from "@/lib/env";
import { analystsFromJournal, reconstructJournal } from "@/server/scoring/reconstruct";

export const dynamic = "force-dynamic";

interface PageProps {
  readonly params: Promise<{ namespace: string }>;
  readonly searchParams: Promise<{ q?: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { namespace } = await params;
  return { title: `Memory journal ${decodeURIComponent(namespace)}` };
}

const NEUTRAL_QUERY = "saksi memory record";

export default async function JournalDetailPage({ params, searchParams }: PageProps) {
  const { namespace: raw } = await params;
  const { q } = await searchParams;
  const namespace = decodeURIComponent(raw);
  const prefix = getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX;

  // Only history namespaces under this deployment's prefix are exposed, so a hand-typed URL
  // cannot turn this page into a reader for unrelated relayer tenants. Identity namespaces
  // are refused too: they hold one record each and no track record to reconstruct.
  if (!namespace.startsWith(`${prefix}:`)) notFound();
  if (namespace.startsWith(`${prefix}:wallet:`) || namespace.startsWith(`${prefix}:recovery:`)) {
    notFound();
  }

  const query = q?.trim() ?? "";
  const journal = await reconstructJournal(namespace);
  const analysts = analystsFromJournal(journal);

  /*
   * The exact count comes from `listMemories()`, not from the reconstruction. `recall()` is a
   * similarity search ranked server-side before its limit truncates, so it is the wrong tool
   * for "how many memories are there" - the official docs say so explicitly. Reconstruction
   * still uses recall, because it needs the text of the memories that match its query.
   */
  const exact = await listMemories(namespace.slice(namespace.indexOf(":") + 1), 500);
  const listing = await recallNamespace(namespace, NEUTRAL_QUERY, 100);
  const searched = query.length > 0 ? await recallNamespace(namespace, query, 100) : null;

  const entries = listing.hits
    .map((hit) => ({
      blobId: hit.citation.blobId,
      createdAt: hit.citation.createdAt ?? null,
      memory: hit.memory ?? parseMemory(hit.citation.text),
      text: hit.citation.text,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  const resolved = analysts.reduce((sum, analyst) => sum + analyst.credibility.resolved, 0);
  const biasPatterns = analysts.flatMap((analyst) => analyst.bias);

  return (
    <div>
      <PageHeader
        eyebrow="Walrus Memory · read-only"
        title={namespace}
        description="Everything on this page was read from the relayer for this namespace. There is no session, no wallet and no database query behind it. Pick records are joined on the ids inside the memory text itself."
        actions={
          <Link href="/journals" className="btn btn-ghost">
            All journals
          </Link>
        }
      />

      <div className="container-page pb-20">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Memories in this namespace"
            value={exact.fetched}
            detail="listMemories() pages, exact count"
            tone="amber"
          />
          <StatCard
            label="Reconstructed picks"
            value={journal.picks.length}
            detail="commit joined to reveal and outcome"
          />
          <StatCard
            label="Resolved"
            value={resolved}
            detail="picks with an outcome memory"
            tone="green"
          />
          <StatCard
            label="Bias patterns"
            value={biasPatterns.length}
            detail="derived from memory, not from SQL"
            tone={biasPatterns.length > 0 ? "amber" : "paper"}
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-2">
          {JOURNAL_MEMORY_KINDS.map((kind) => {
            const present = journal.kinds.includes(kind);
            return (
              <span
                key={kind}
                className={present ? "badge badge-win" : "badge badge-neutral opacity-50"}
              >
                {kind}
                {present ? "" : " · none"}
              </span>
            );
          })}
        </div>

        <div className="mt-10 grid gap-8 lg:grid-cols-[1.25fr_0.75fr]">
          <section>
            <h2 className="display text-3xl">Reconstructed track record</h2>
            <p className="text-muted mt-2 text-xs leading-relaxed">
              A memory record carries no oracle flag, so every outcome here is treated as the
              journal&apos;s own claim. The verified score is therefore always zero on this page —
              that is honesty, not a bug.
            </p>

            {analysts.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title="No reconstructed picks"
                  description="This namespace holds memories, but none of them form a commit plus outcome pair that can be joined."
                />
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {analysts.map((analyst) => (
                  <div key={analyst.analystId} className="card p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Hash value={analyst.analystId} head={12} tail={8} />
                      <span className="mono text-amber text-[10px]">
                        score {analyst.credibility.score}/100
                      </span>
                    </div>
                    <div className="text-muted mt-3 flex flex-wrap gap-4 text-xs">
                      <span>
                        resolved{" "}
                        <span className="mono text-paper">{analyst.credibility.resolved}</span>
                      </span>
                      <span>
                        wins <span className="mono text-paper">{analyst.credibility.wins}</span>
                      </span>
                      <span>
                        losses <span className="mono text-paper">{analyst.credibility.losses}</span>
                      </span>
                      <span>
                        mean Brier{" "}
                        <span className="mono text-paper">
                          {analyst.credibility.meanBrier === null
                            ? "—"
                            : analyst.credibility.meanBrier.toFixed(3)}
                        </span>
                      </span>
                    </div>
                    {analyst.bias.length > 0 ? (
                      <div className="mt-3 space-y-1">
                        {analyst.bias.map((pattern) => (
                          <p key={pattern.pattern} className="mono text-amber text-[11px]">
                            bias · {pattern.pattern} · confidence {pattern.confidence.toFixed(3)}
                          </p>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}

            <h2 className="display mt-10 text-3xl">Picks</h2>
            <div className="card divide-line mt-4 divide-y">
              {journal.picks.length === 0 ? (
                <p className="text-muted p-5 text-sm">No joined picks in this namespace.</p>
              ) : (
                journal.picks.map((pick) => (
                  <div key={pick.pickId} className="p-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="mono text-paper text-xs">
                        {pick.market ?? "unknown market"}
                      </span>
                      <span className="mono text-muted text-[10px]">{pick.pickId}</span>
                    </div>
                    <div className="text-muted mt-2 flex flex-wrap gap-4 text-xs">
                      <span>
                        selection{" "}
                        <span className="text-paper">{pick.selection ?? "not revealed"}</span>
                      </span>
                      <span>
                        odds <span className="mono text-paper">{pick.odds ?? "—"}</span>
                      </span>
                      <span>
                        result{" "}
                        <span className={pick.result === "loss" ? "text-red" : "text-green"}>
                          {pick.result ?? "unresolved"}
                        </span>
                      </span>
                      {pick.brier !== null ? (
                        <span>
                          brier <span className="mono text-paper">{pick.brier.toFixed(3)}</span>
                        </span>
                      ) : null}
                    </div>
                    {pick.committedAt ? (
                      <p className="mono text-muted mt-2 text-[10px]">
                        committed {formatDateTime(pick.committedAt)}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <section className="card p-6">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Recall</p>
              <h2 className="display mt-2 text-2xl">Search this journal</h2>
              <form method="GET" className="mt-4 flex flex-col gap-2">
                <input
                  name="q"
                  className="input"
                  defaultValue={query}
                  placeholder="underdog losses, payment, preference…"
                />
                <button type="submit" className="btn">
                  Recall
                </button>
              </form>
              {searched === null ? (
                <p className="text-muted mt-3 text-xs leading-relaxed">
                  Run a query to see the cosine distance the relayer reports for each match.
                </p>
              ) : searched.hits.length === 0 ? (
                <p className="text-muted mt-3 text-xs leading-relaxed">
                  No memories matched this query.
                </p>
              ) : (
                <div className="mt-3 space-y-2">
                  {searched.hits.slice(0, 10).map((hit) => (
                    <div key={hit.citation.blobId} className="border-line rounded-xl border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="badge badge-neutral">
                          {hit.memory?.kind ?? "unparsed"}
                        </span>
                        <span className="mono text-amber text-[10px]">
                          distance {hit.citation.distance.toFixed(4)}
                        </span>
                      </div>
                      <p className="text-muted mt-2 font-mono text-[10px] leading-relaxed break-all">
                        {hit.citation.text.slice(0, 220)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="card p-6">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Raw memories
              </p>
              <h2 className="display mt-2 text-2xl">{entries.length} blobs</h2>
              <p className="text-muted mt-2 text-xs leading-relaxed">
                Decrypted by <span className="mono">recall()</span>. The relayer returns text only
                through recall, so this list is the same call the recommender uses.
              </p>
              <div className="mt-4 space-y-2">
                {entries.slice(0, 12).map((entry) => (
                  <div key={entry.blobId} className="border-line rounded-lg border p-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="badge badge-neutral">
                        {entry.memory?.kind ?? "unparsed"}
                      </span>
                      <span className="mono text-muted text-[9px]">
                        {entry.blobId.slice(0, 10)}…
                      </span>
                    </div>
                    <p className="text-muted mt-1.5 font-mono text-[10px] leading-relaxed break-all">
                      {entry.text.slice(0, 150)}
                    </p>
                  </div>
                ))}
              </div>
              {entries.length > 12 ? (
                <p className="mono text-muted mt-3 text-[10px]">showing 12 of {entries.length}</p>
              ) : null}
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
