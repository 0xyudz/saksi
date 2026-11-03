import Link from "next/link";
import { notFound } from "next/navigation";

import { RevealButton } from "@/components/forms/RevealButton";
import { ResolveForm } from "@/components/forms/ResolveForm";
import {
  Hash,
  OutcomeBadge,
  PageHeader,
  ProofLine,
  StatusBadge,
  VerificationBadge,
} from "@/components/ui";
import { formatDate, formatDateTime, formatOdds, formatPercent } from "@/lib/format";
import { isUuid } from "@/lib/ids";
import { getSessionUser } from "@/lib/session";
import { getPickDetail } from "@/server/data/picks";
import { presentPick } from "@/server/presenters/pick";
import { verifyCommitment } from "@/server/scoring/commitment";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return { title: "Pick" };
  const detail = await getPickDetail(id);
  return { title: detail ? `${detail.pick.market} · pick` : "Pick" };
}

export default async function PickDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const detail = await getPickDetail(id);
  if (!detail) notFound();

  const user = await getSessionUser();
  const view = presentPick({
    pick: detail.pick,
    viewerId: user?.id,
    ownerHandle: detail.ownerHandle,
    analystName: detail.analystName,
    analystKind: detail.analystKind,
    outcome:
      detail.outcome === null
        ? null
        : {
            result: detail.outcome.result,
            resolvedAt: detail.outcome.resolvedAt,
            sourceUrl: detail.outcome.sourceUrl,
            resolvedBy: detail.outcome.resolvedBy,
            brier: detail.outcome.brier,
            payoutUnits: detail.outcome.payoutUnits,
            verification: detail.outcome.verification,
            oracleResult: detail.outcome.oracleResult,
            oracleNote: detail.outcome.oracleNote,
          },
  });

  const commitmentValid = verifyCommitment(detail.pick.pickPayload, detail.pick.commitmentHash);

  return (
    <div>
      <PageHeader
        eyebrow={`Commitment · ${detail.analystName}`}
        title={view.selection ?? "Sealed prediction"}
        description={
          view.market
            ? `${view.market}${view.eventRef ? ` · ${view.eventRef}` : ""}`
            : `@${view.ownerHandle} has not revealed this pick yet. Only the hash is public.`
        }
        actions={
          <>
            <StatusBadge status={view.status} />
            {view.outcome ? <OutcomeBadge result={view.outcome.result} /> : null}
            <Link href="/picks" className="btn btn-ghost">
              Back to ledger
            </Link>
          </>
        }
      />

      <div className="container-page grid gap-6 pb-20 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
              Commitment proof
            </p>
            <div className="mt-3">
              <ProofLine label="sha256(canonical(pick))" value={detail.pick.commitmentHash} />
              <ProofLine label="Owner" value={`@${detail.ownerHandle}`} mono={false} />
              <ProofLine
                label="Analyst"
                value={`${detail.analystName} · ${detail.analystKind}`}
                mono={false}
              />
              <ProofLine label="Committed" value={formatDateTime(detail.pick.committedAt)} />
              <ProofLine
                label="Time lock"
                value={detail.pick.revealAt ? formatDateTime(detail.pick.revealAt) : "none"}
              />
              <ProofLine
                label="Stored payload matches hash"
                value={commitmentValid ? "yes" : "NO — reveal refused"}
                mono={false}
              />
              <ProofLine
                label="Independent fixture"
                value={detail.pick.oracleEventRef ?? "not linked (self-attested only)"}
              />
            </div>
            {!commitmentValid ? (
              <p className="border-red/30 bg-red/10 text-red mt-3 rounded-xl border p-3 text-xs">
                The stored payload no longer matches its commitment. Saksi will refuse to reveal or
                resolve this pick.
              </p>
            ) : null}
          </section>

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
              Revealed content
            </p>
            {view.market && view.selection ? (
              <>
                <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <p className="text-muted text-[11px]">Odds</p>
                    <p className="mono mt-1 text-lg">{view.odds ? formatOdds(view.odds) : "—"}</p>
                  </div>
                  <div>
                    <p className="text-muted text-[11px]">Implied</p>
                    <p className="mono mt-1 text-lg">
                      {view.odds ? formatPercent(1 / view.odds) : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted text-[11px]">Stake</p>
                    <p className="mono mt-1 text-lg">{view.stakeUnits ?? "—"}u</p>
                  </div>
                  <div>
                    <p className="text-muted text-[11px]">Brier</p>
                    <p className="mono mt-1 text-lg">
                      {view.outcome?.brier === null || view.outcome?.brier === undefined
                        ? "—"
                        : view.outcome.brier.toFixed(3)}
                    </p>
                  </div>
                </div>
                <div className="mt-4">
                  <ProofLine label="Selection" value={view.selection} mono={false} />
                  <ProofLine label="Market" value={view.market} mono={false} />
                  <ProofLine label="Event reference" value={view.eventRef ?? "—"} />
                </div>
              </>
            ) : (
              <p className="text-muted mt-3 text-sm leading-relaxed">
                The payload is hidden because this pick is still sealed. Revealing recomputes the
                canonical hash and refuses to proceed if any field changed.
              </p>
            )}
          </section>

          {view.outcome ? (
            <section className="card p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                  Resolution
                </p>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {view.outcome ? (
                    <VerificationBadge verification={view.outcome.verification} />
                  ) : null}
                  <OutcomeBadge result={view.outcome.result} />
                </div>
              </div>
              <p className="display mt-3 text-2xl">
                {view.outcome.result === "win"
                  ? "Called it."
                  : view.outcome.result === "loss"
                    ? "Missed."
                    : "Voided."}
              </p>
              {view.outcome.verification === "oracle_verified" ? (
                <p className="text-muted mt-2 text-xs leading-relaxed">
                  An independent results provider confirmed this outcome. It counts toward the
                  analyst&apos;s verified record.
                </p>
              ) : view.outcome.verification === "oracle_contradicted" ? (
                <p className="border-red/30 bg-red/10 text-red mt-2 rounded-xl border p-3 text-xs leading-relaxed">
                  {view.outcome.oracleNote ?? "The independent provider disagreed with this claim."}{" "}
                  The owner&apos;s claim is preserved here, but it does not count toward a verified
                  record.
                </p>
              ) : (
                <p className="text-muted mt-2 text-xs leading-relaxed">
                  No independent provider confirmed this result, so it counts as self-attested and
                  is excluded from the verified record.
                  {view.outcome.oracleNote ? ` ${view.outcome.oracleNote}` : ""}
                </p>
              )}
              <div className="mt-3">
                <ProofLine label="Resolved at" value={formatDateTime(view.outcome.resolvedAt)} />
                <ProofLine
                  label="Source"
                  value={view.outcome.sourceUrl}
                  href={view.outcome.sourceUrl}
                />
                <ProofLine
                  label="Brier"
                  value={view.outcome.brier === null ? "void" : view.outcome.brier.toFixed(4)}
                />
                <ProofLine
                  label="Payout units"
                  value={view.outcome.payoutUnits === null ? "—" : String(view.outcome.payoutUnits)}
                />
              </div>
            </section>
          ) : null}
        </div>

        <aside className="space-y-6">
          {view.isOwner ? (
            <>
              <section className="card p-6">
                <p className="mono text-amber text-[10px] tracking-[0.18em] uppercase">
                  Owner action
                </p>
                <h2 className="display mt-2 text-2xl">
                  {view.status === "sealed" ? "Reveal the commitment" : "Resolve the outcome"}
                </h2>
                <p className="text-muted mt-2 mb-4 text-xs leading-relaxed">
                  {view.status === "sealed"
                    ? "Revealing checks the stored payload against the hash. A mismatch is a hard stop."
                    : view.status === "revealed"
                      ? "Attach the source URL that proves the result. This writes an outcome memory and recalculates the analyst's credibility."
                      : "This pick is already finalized."}
                </p>
                {view.status === "sealed" ? (
                  <RevealButton pickId={view.id} disabledReason={view.revealBlockedReason} />
                ) : null}
                {view.status === "revealed" ? <ResolveForm pickId={view.id} /> : null}
              </section>
            </>
          ) : (
            <section className="card p-6">
              <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
                Public proof
              </p>
              <p className="text-muted mt-3 text-xs leading-relaxed">
                This pick belongs to @{view.ownerHandle}. You can verify the hash and follow the
                outcome source, but only the owner can reveal or resolve it.
              </p>
              <div className="mt-4 flex items-center gap-2">
                <span className="mono text-muted text-[10px]">hash</span>
                <Hash value={view.commitmentHash} head={14} tail={12} />
              </div>
            </section>
          )}

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">
              Why this is checkable
            </p>
            <ol className="text-muted mt-3 space-y-3 text-xs leading-relaxed">
              <li>
                <span className="text-amber">01</span> Canonical JSON sorts keys and removes
                insignificant whitespace.
              </li>
              <li>
                <span className="text-amber">02</span> The hash was stored before the event,
                alongside the full payload in Walrus Memory.
              </li>
              <li>
                <span className="text-amber">03</span> Reveal recomputes the same bytes. Editing any
                field changes the hash.
              </li>
              <li>
                <span className="text-amber">04</span> Resolution adds a source URL and timestamp,
                then scores calibration.
              </li>
            </ol>
          </section>

          <section className="card p-6">
            <p className="mono text-muted text-[10px] tracking-[0.18em] uppercase">Timeline</p>
            <div className="text-muted mt-3 space-y-2 text-xs">
              <p>
                committed{" "}
                <span className="mono text-paper">{formatDate(detail.pick.committedAt)}</span>
              </p>
              <p>
                reveal{" "}
                <span className="mono text-paper">
                  {detail.pick.revealAt ? formatDate(detail.pick.revealAt) : "owner-triggered"}
                </span>
              </p>
              <p>
                resolved{" "}
                <span className="mono text-paper">
                  {detail.outcome ? formatDate(detail.outcome.resolvedAt) : "pending"}
                </span>
              </p>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
