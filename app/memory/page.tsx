import Link from "next/link";

import { PreferenceForm } from "@/components/forms/PreferenceForm";
import { EmptyState, Hash, PageHeader, ProofLine, StatCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { requireSessionUser } from "@/lib/session";
import { countMemoryWrites } from "@/server/data/lifecycle";
import { memoryLedger, recallMemories } from "@/server/data/memory";

export const dynamic = "force-dynamic";
export const metadata = { title: "Memory" };

export default async function MemoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireSessionUser();
  const { q } = await searchParams;
  const query = q?.trim() ?? "";
  const [ledger, auditRows] = await Promise.all([memoryLedger(user.id), countMemoryWrites()]);
  const recalled = query.length > 0 ? await recallMemories(user.id, query) : null;

  return (
    <div>
      <PageHeader
        eyebrow={`Namespace · ${user.handle}`}
        title="The memory ledger."
        description="This page counts and lists memories from the Walrus Memory relayer, not from Postgres. Search runs a real recall against your namespace and shows the memory text with its cosine distance."
        actions={
          <Link href="/picks/new" className="btn btn-primary">
            Use memory on a pick
          </Link>
        }
      />

      <div className="container-page pb-20">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Relayer memories"
            value={ledger.page.total}
            detail="from listMemories()"
            tone="amber"
          />
          <StatCard
            label="Relayer status"
            value={ledger.health.status}
            detail={`version ${ledger.health.version}`}
            tone="green"
          />
          <StatCard
            label="Local audit rows"
            value={auditRows}
            detail="memoryWrites table, for operators"
          />
          <StatCard
            label="Recall limit"
            value="env"
            detail="relevance sorted, configured by WALRUS_RECALL_LIMIT"
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_0.7fr]">
          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Recall</p>
            <h2 className="display mt-2 text-2xl">Ask your memory</h2>
            <form method="GET" className="mt-4 flex flex-col gap-2 sm:flex-row">
              <input
                name="q"
                className="input"
                defaultValue={query}
                placeholder="underdog losses, paid source ROI, market you follow…"
              />
              <button type="submit" className="btn">
                Recall
              </button>
            </form>

            {recalled === null ? (
              <p className="text-muted mt-4 text-xs leading-relaxed">
                Nothing has been recalled yet. Ask a question to see the exact memories and
                distances the recommender uses.
              </p>
            ) : recalled.length === 0 ? (
              <p className="text-muted mt-4 text-xs leading-relaxed">
                The relayer returned no memories for this query. Write a preference or seal a pick
                before recalling.
              </p>
            ) : (
              <div className="mt-4 space-y-2">
                {recalled.map((citation) => (
                  <div key={citation.blobId} className="border-line rounded-xl border p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Hash value={citation.blobId} head={14} tail={12} />
                      <span className="mono text-amber text-[10px]">
                        distance {citation.distance.toFixed(4)}
                      </span>
                    </div>
                    <p className="text-paper/85 mt-2 font-mono text-[11px] leading-relaxed break-all">
                      {citation.text}
                    </p>
                    {citation.createdAt ? (
                      <p className="mono text-muted mt-2 text-[10px]">
                        written {formatDateTime(citation.createdAt)}
                      </p>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </section>

          <aside className="space-y-6">
            <section className="card p-6">
              <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
                Teach the journal
              </p>
              <h2 className="display mt-2 text-2xl">Remember a preference</h2>
              <p className="text-muted mt-2 mb-4 text-xs leading-relaxed">
                Preferences are recalled alongside bias and source ROI. They are stored as validated
                Saksi v1 memory records in the same namespace.
              </p>
              <PreferenceForm />
            </section>

            <section className="card p-6">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Storage contract
              </p>
              <div className="mt-3">
                <ProofLine label="Namespace" value={`<prefix>:${user.id}`} />
                <ProofLine label="Format" value="saksi:v1|type=…" />
                <ProofLine label="Validation" value="build + parse before write" mono={false} />
                <ProofLine label="Audit" value="memoryWrites(blobId, jobId)" />
              </div>
            </section>
          </aside>
        </div>

        <section className="mt-8">
          <div className="mb-3 flex items-end justify-between">
            <div>
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                listMemories()
              </p>
              <h2 className="display mt-2 text-3xl">Relayer contents</h2>
            </div>
            <span className="mono text-muted text-[10px]">
              {ledger.page.memories.length} shown · total {ledger.page.total}
            </span>
          </div>

          {ledger.page.memories.length === 0 ? (
            <EmptyState
              title="This namespace is empty"
              description="Seal a pick, resolve an outcome, or write a preference. The list below comes from the relayer, so it will stay empty until a real write lands."
            />
          ) : (
            <div className="card divide-line divide-y">
              {ledger.page.memories.map((memory) => (
                <div
                  key={memory.memoryId}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Hash value={memory.blobId} head={16} tail={14} />
                    <span className="badge badge-neutral">{memory.status}</span>
                  </div>
                  <div className="text-muted flex items-center gap-4 text-[10px]">
                    <span className="mono">{memory.size} bytes</span>
                    <span className="mono">{formatDateTime(memory.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          {ledger.page.hasMore ? (
            <p className="text-muted mt-3 text-xs">
              The relayer reports more pages than this view requested. Use the API for the full
              cursor.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
