import Link from "next/link";

import type { PickView } from "@/server/presenters/pick";
import { formatOdds } from "@/lib/format";
import { Hash, OutcomeBadge, StatusBadge, Timestamp } from "@/components/ui";

export function PickCard({ pick }: { readonly pick: PickView }) {
  return (
    <article className="card p-5 transition-colors hover:border-white/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <StatusBadge status={pick.status} />
          {pick.outcome ? <OutcomeBadge result={pick.outcome.result} /> : null}
          {pick.isOwner ? <span className="badge badge-neutral">your journal</span> : null}
        </div>
        <Timestamp value={pick.committedAt} />
      </div>

      <div className="mt-4">
        {pick.market && pick.selection ? (
          <>
            <p className="mono text-muted text-[10px] tracking-[0.16em] uppercase">
              {pick.market}
              {pick.eventRef ? <span className="text-muted/60"> · {pick.eventRef}</span> : null}
            </p>
            <p className="display mt-2 text-2xl">{pick.selection}</p>
            <div className="text-muted mt-3 flex flex-wrap items-center gap-4 text-xs">
              <span>
                odds{" "}
                <span className="mono text-paper">{pick.odds ? formatOdds(pick.odds) : "—"}</span>
              </span>
              <span>
                stake <span className="mono text-paper">{pick.stakeUnits ?? "—"}u</span>
              </span>
              <span>
                analyst <span className="text-paper">{pick.analystName}</span>
              </span>
              <span>
                by <span className="text-paper">@{pick.ownerHandle}</span>
              </span>
            </div>
          </>
        ) : (
          <div>
            <p className="display text-muted text-2xl">Sealed prediction</p>
            <p className="text-muted mt-2 text-xs leading-relaxed">
              Content stays hidden until @{pick.ownerHandle} reveals it. The commitment below was
              written to Walrus Memory before the event.
            </p>
          </div>
        )}
      </div>

      <div className="border-line mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <div className="flex items-center gap-2">
          <span className="mono text-muted text-[10px] tracking-[0.14em] uppercase">commit</span>
          <Hash value={pick.commitmentHash} head={12} tail={10} />
        </div>
        <Link href={`/picks/${pick.id}`} className="link-underline text-amber text-xs">
          Open proof →
        </Link>
      </div>
    </article>
  );
}
