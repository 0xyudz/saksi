import type { AnalystKind, OutcomeResult, PickStatus } from "@/lib/domain";

/**
 * How an outcome came to exist. `self_attested` means the owner supplied it; the other two
 * mean an independent results provider agreed or disagreed. Only `oracle_verified` counts
 * toward a seller's verified record, so the distinction must survive all the way to the UI.
 */
export type OutcomeVerification = "self_attested" | "oracle_verified" | "oracle_contradicted";

export interface PresentableOutcome {
  readonly result: OutcomeResult;
  readonly resolvedAt: Date;
  readonly sourceUrl: string;
  readonly resolvedBy: string;
  readonly brier: number | null;
  readonly payoutUnits?: number | null;
  readonly verification?: OutcomeVerification;
  readonly oracleResult?: OutcomeResult | null;
  readonly oracleNote?: string | null;
}

export interface PresentablePick {
  readonly id: string;
  readonly userId: string;
  readonly status: PickStatus;
  readonly eventRef: string;
  readonly market: string;
  readonly selection: string;
  readonly odds: number;
  readonly stakeUnits: number;
  readonly commitmentHash: string;
  readonly committedAt: Date;
  readonly revealAt: Date | null;
  /** Independent fixture fixed at seal time, if the owner linked one. */
  readonly oracleEventRef?: string | null;
}

export interface PickView {
  readonly id: string;
  readonly isOwner: boolean;
  readonly sealed: boolean;
  readonly status: PickStatus;
  readonly ownerHandle: string;
  readonly analystName: string;
  readonly analystKind: AnalystKind;
  readonly eventRef: string | null;
  readonly market: string | null;
  readonly selection: string | null;
  readonly odds: number | null;
  readonly stakeUnits: number | null;
  readonly commitmentHash: string;
  readonly committedAt: string;
  readonly revealAt: string | null;
  readonly outcome: {
    readonly result: OutcomeResult;
    readonly resolvedAt: string;
    readonly sourceUrl: string;
    readonly resolvedBy: string;
    readonly selfAttested: boolean;
    readonly verification: OutcomeVerification;
    readonly oracleResult: OutcomeResult | null;
    readonly oracleNote: string | null;
    readonly brier: number | null;
    readonly payoutUnits: number | null;
  } | null;
  readonly canReveal: boolean;
  readonly canResolve: boolean;
  readonly revealBlockedReason: string | null;
  /** Whether this pick was linked to an independent fixture at seal time. */
  readonly oracleLinked: boolean;
}

/**
 * Sealed content is only ever serialized to its owner. Public callers receive the
 * commitment hash and timestamp, which is exactly what makes the claim checkable.
 */
export function presentPick(input: {
  readonly pick: PresentablePick;
  readonly viewerId: string | undefined;
  readonly ownerHandle: string;
  readonly analystName: string;
  readonly analystKind: AnalystKind;
  readonly outcome: PresentableOutcome | null;
  readonly now?: Date;
}): PickView {
  const { pick } = input;
  const isOwner = input.viewerId === pick.userId;
  const sealed = pick.status === "sealed";
  const visible = isOwner || !sealed;
  const now = input.now ?? new Date();
  const revealAtMs = pick.revealAt?.getTime() ?? null;
  const revealWait = revealAtMs !== null && revealAtMs > now.getTime();
  const canReveal = isOwner && sealed && !revealWait;
  const canResolve = isOwner && pick.status === "revealed";

  return {
    id: pick.id,
    isOwner,
    sealed,
    status: pick.status,
    ownerHandle: input.ownerHandle,
    analystName: input.analystName,
    analystKind: input.analystKind,
    eventRef: visible ? pick.eventRef : null,
    market: visible ? pick.market : null,
    selection: visible ? pick.selection : null,
    odds: visible ? pick.odds : null,
    stakeUnits: visible ? pick.stakeUnits : null,
    commitmentHash: pick.commitmentHash,
    committedAt: pick.committedAt.toISOString(),
    revealAt: pick.revealAt?.toISOString() ?? null,
    outcome:
      input.outcome === null
        ? null
        : {
            result: input.outcome.result,
            resolvedAt: input.outcome.resolvedAt.toISOString(),
            sourceUrl: input.outcome.sourceUrl,
            resolvedBy: input.outcome.resolvedBy,
            selfAttested: input.outcome.resolvedBy.startsWith("user:"),
            verification: input.outcome.verification ?? "self_attested",
            oracleResult: input.outcome.oracleResult ?? null,
            oracleNote: input.outcome.oracleNote ?? null,
            brier: input.outcome.brier,
            payoutUnits: input.outcome.payoutUnits ?? null,
          },
    canReveal,
    canResolve,
    revealBlockedReason: revealWait
      ? `The commitment is time-locked until ${pick.revealAt?.toISOString() ?? "the reveal time"}.`
      : null,
    oracleLinked: (pick.oracleEventRef ?? null) !== null,
  };
}
