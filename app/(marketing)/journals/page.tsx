import Link from "next/link";

import { PageHeader, StatCard } from "@/components/ui";
import { listNamespaces } from "@/integrations/walrus-memory/client";
import { JOURNAL_MEMORY_KINDS } from "@/integrations/walrus-memory/schema";
import { getEnv } from "@/lib/env";
import { analystsFromJournal, reconstructJournal } from "@/server/scoring/reconstruct";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Public memory journals",
  description:
    "Live Walrus Memory journals, reconstructed from the relayer with no database in the read path.",
};

/**
 * A read-only window into what the relayer actually stores.
 *
 * Deliberately outside the session-gated app group: a reviewer with no wallet and no
 * account can open this page and see real memories. It reads only Walrus Memory, so if
 * the relayer is down the page says so instead of falling back to a database.
 */
export default async function JournalsPage() {
  const prefix = getEnv().WALRUS_MEMORY_NAMESPACE_PREFIX;

  let namespaces: Awaited<ReturnType<typeof listNamespaces>> = [];
  let failure: string | null = null;

  try {
    namespaces = await listNamespaces();
  } catch (error) {
    failure = error instanceof Error ? error.message : "The relayer did not answer.";
  }

  /*
   * Identity namespaces (`saksi:wallet:<address>` and `saksi:recovery:<digest>`) are listed
   * by the relayer like any other, but they are not journals: they hold one identity record
   * each and no history. Filtering them out is what keeps "journals" meaning journals.
   */
  const journals = namespaces
    .filter(
      (entry) =>
        entry.name.startsWith(`${prefix}:`) &&
        !entry.name.startsWith(`${prefix}:wallet:`) &&
        !entry.name.startsWith(`${prefix}:recovery:`) &&
        !entry.name.includes(":probe:"),
    )
    .sort((a, b) => b.memoryCount - a.memoryCount);

  const identityNamespaces = namespaces.filter(
    (entry) =>
      entry.name.startsWith(`${prefix}:wallet:`) || entry.name.startsWith(`${prefix}:recovery:`),
  );

  return (
    <div>
      <PageHeader
        eyebrow="Walrus Memory · live"
        title="Journals the relayer actually holds."
        description="Every number below is read from the Walrus Memory relayer at request time. There is no cache and no local table in this read path: the namespace list, the memory counts and the reconstructed track records all come from the relayer."
      />

      <div className="container-page pb-20">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Journals"
            value={journals.length}
            detail={`history namespaces under "${prefix}:"`}
            tone="amber"
          />
          <StatCard
            label="Memories"
            value={journals.reduce((sum, entry) => sum + entry.memoryCount, 0)}
            detail="sum of relayer-reported counts"
            tone="green"
          />
          <StatCard
            label="Identity records"
            value={identityNamespaces.length}
            detail="wallet and recovery namespaces, excluded above"
          />
          <StatCard
            label="Memory kinds"
            value={JOURNAL_MEMORY_KINDS.length}
            detail={JOURNAL_MEMORY_KINDS.join(", ")}
          />
          <StatCard
            label="Read path"
            value="no SQL"
            detail="listNamespaces() + recall(), nothing else"
          />
        </div>

        {failure ? (
          <div className="card border-red/40 mt-8 p-6">
            <p className="mono text-red text-[10px] tracking-[0.18em] uppercase">
              Relayer unavailable
            </p>
            <p className="text-muted mt-3 text-sm leading-relaxed">
              The relayer did not answer, so this page shows nothing rather than a substitute.{" "}
              {failure}
            </p>
          </div>
        ) : null}

        {!failure && journals.length === 0 ? (
          <div className="card mt-8 p-6">
            <p className="text-muted text-sm leading-relaxed">
              The relayer holds no namespace under this prefix yet.
            </p>
          </div>
        ) : null}

        <div className="mt-8 space-y-3">
          {await Promise.all(
            journals.map(async (entry) => {
              const journal = await reconstructJournal(entry.name);
              const analysts = analystsFromJournal(journal);
              const resolved = analysts.reduce(
                (sum, analyst) => sum + analyst.credibility.resolved,
                0,
              );
              const biasPatterns = analysts.flatMap((analyst) => analyst.bias);

              return (
                <Link
                  key={entry.name}
                  href={`/journals/${encodeURIComponent(entry.name)}`}
                  className="card block p-5 transition-colors hover:border-white/20"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="mono text-amber text-xs">{entry.name}</span>
                    <span className="mono text-muted text-[10px]">
                      {entry.memoryCount} memories · {entry.storageUsed} bytes
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2">
                    {JOURNAL_MEMORY_KINDS.filter((kind) => journal.kinds.includes(kind)).map(
                      (kind) => (
                        <span key={kind} className="badge badge-win">
                          {kind}
                        </span>
                      ),
                    )}
                    {journal.kinds.length === 0 ? (
                      <span className="badge badge-neutral">no decodable records</span>
                    ) : null}
                  </div>

                  <div className="text-muted mt-3 flex flex-wrap items-center gap-4 text-xs">
                    <span>
                      reconstructed picks{" "}
                      <span className="mono text-paper">{journal.picks.length}</span>
                    </span>
                    <span>
                      resolved <span className="mono text-paper">{resolved}</span>
                    </span>
                    <span>
                      bias patterns{" "}
                      <span
                        className={biasPatterns.length > 0 ? "mono text-amber" : "mono text-paper"}
                      >
                        {biasPatterns.length}
                      </span>
                    </span>
                  </div>
                </Link>
              );
            }),
          )}
        </div>

        <p className="text-muted mt-8 max-w-2xl text-xs leading-relaxed">
          A journal is only visible here because Walrus Memory namespaces are readable by the
          relayer account that wrote them. Nothing on this page can write, and no session is
          involved. Namespaces are the deterministic{" "}
          <span className="mono">{`${prefix}:<journal id>`}</span> form, which is why they are shown
          in full rather than prettified.
        </p>

        <p className="text-muted mt-4 max-w-2xl text-xs leading-relaxed">
          Reconstructed track records come from joining <span className="mono">pick_commit</span> to{" "}
          <span className="mono">outcome</span> on the pick id inside the memory text. Because a
          memory record carries no oracle flag, every reconstructed outcome is treated as the
          journal&apos;s own claim and the verified score stays at zero.
        </p>
      </div>
    </div>
  );
}
